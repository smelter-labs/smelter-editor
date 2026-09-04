#!/usr/bin/env python3
"""People-counter sidecar: subscribes to video side channels via smelter-sdk,
counts the number of people/faces per frame, reports results over WebSocket.

Three swappable detection backends, selected via PEOPLE_COUNTER_BACKEND:
  - yolo:      ultralytics YOLOv8 (counts `person` boxes)
  - mediapipe: MediaPipe FaceDetection (counts faces)
  - haar:      OpenCV Haar cascade faces (default — no heavy deps)

Independently of the backend, an input can set source='markers' to skip
inference entirely and read rectangles drawn into the footage instead.

Backends are loaded lazily on first use, so a missing heavy package (torch /
mediapipe) only disables that backend rather than crashing the worker — Haar
always works because it ships with opencv."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import statistics
import sys
import threading
import time
from collections import deque
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
# Marker mode runs unthrottled. Markers are typically drawn on one keyframe per
# second, so a skipped frame is not "slightly stale data" like it is for YOLO —
# it is the only frame that second which carries any information at all. Keying
# costs a few ms against a 33ms frame interval, so there is room to look at all
# of them.
MARKER_OUTPUT_INTERVAL_S = 0.0
# Marker interpolation. Keyframes arrive ~1/s; the side-channel delay gives a
# lookahead window (the worker sees frames delayMs before the output presents
# them), so results can describe a source-time far enough in the PAST that the
# next keyframe is already known — and glide between the two. See
# _marker_interpolate for the timing contract.
MARKER_KEYFRAMES_MAX = 8  # covers every-frame markers at 30fps within lookback
MARKER_INTERP_MARGIN_S = 0.25  # delay must exceed gap*1.15 + this
MARKER_LOOKBACK_PAD_S = 0.15  # lookback = gap*1.25 + pad
MARKER_LOOKBACK_CAP_PAD_S = 0.05  # keep lookback <= delay - this
MARKER_GAP_RESET_FACTOR = 3.0  # arrival gap > 3x EMA (and > 3s) = discontinuity
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
# Class selection by *name* (comma-separated, case-insensitive substring match
# against the loaded model's class map). Unlike numeric ids this survives a
# weights swap to a non-COCO model (e.g. the flying-objects weights label birds
# "Bird", id != 14). When set, it wins over PEOPLE_COUNTER_YOLO_CLASSES.
YOLO_CLASS_NAMES = {
    n.strip().lower()
    for n in os.environ.get("PEOPLE_COUNTER_YOLO_CLASS_NAMES", "").split(",")
    if n.strip()
}


@dataclass
class InputState:
    last_output_at: float = 0.0
    side_channel_ready: bool = False
    first_seen_at: float = field(default_factory=time.monotonic)
    # Per-input tunables pushed from Node (keys: 'confidence', 'imgsz').
    params: dict = field(default_factory=dict)
    # Motion-fusion baselines: downscaled grayscale of the two previously
    # processed frames (double-difference needs both), plus when the newest one
    # was taken so a stale baseline resets instead of diffing across a gap.
    prev_gray: np.ndarray | None = None
    prev2_gray: np.ndarray | None = None
    prev_gray_at: float = 0.0
    # Marker mode: the last frame that actually contained markers, and when it
    # was seen. Markers are usually drawn on a keyframe rather than on every
    # frame, so the boxes have to survive the frames in between (see the hold
    # in _marker_detect) or the overlay would flash once and disappear.
    marker_boxes: list[dict] = field(default_factory=list)
    marker_seen_at: float = 0.0
    # Interpolation: recent marker keyframes [(t_arrival, boxes)], newest last,
    # plus an EMA of the keyframe arrival gap. Fed by _marker_detect, consumed
    # by _marker_interpolate.
    marker_keyframes: deque = field(
        default_factory=lambda: deque(maxlen=MARKER_KEYFRAMES_MAX)
    )
    marker_gap_ema: float = 0.0
    # One-shot log latch for "delay too small to interpolate".
    marker_warned_delay: bool = False


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

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# Where bare weight filenames are looked up; the first dir is also the
# download target for custom (non-ultralytics) weights.
_WEIGHTS_DIRS = [d for d in (os.path.dirname(YOLO_WEIGHTS), _SCRIPT_DIR) if d]

# Custom weights ultralytics can't auto-download (not its assets) — the worker
# fetches these itself when the file is missing. Trained on flying objects
# (drones/aircraft/birds), so it sees airborne silhouettes COCO mostly lacks.
FLYOBJ_WEIGHTS = "yolov8m_fly_obj_detection.pt"
CUSTOM_WEIGHTS_URLS = {
    FLYOBJ_WEIGHTS: (
        "https://huggingface.co/Javvanny/yolov8m_flying_objects_detection"
        "/resolve/main/yolov8m/weights/best.pt"
    ),
}

_backend_loaded = False
_backend_kind: str | None = None
_yolo_model = None
# Which weights file _yolo_model currently holds, so we only reload on change.
_yolo_weights_loaded: str | None = None
# Class ids matched from YOLO_CLASS_NAMES against the loaded model's class map
# (None = no name filter configured, or no match — detect all classes).
_yolo_classes_by_name: list[int] | None = None
# Guards the (re)load so two detection threads can't swap the model mid-flight.
_yolo_lock = threading.Lock()
_mediapipe_detector = None
_haar_cascade = None


def _resolve_weights(weights: str) -> str:
    """Resolve a bare filename from the UI 'weights' param against the known
    weight directories, so one download serves every input."""
    if os.path.isabs(weights):
        return weights
    for d in _WEIGHTS_DIRS:
        candidate = os.path.join(d, weights)
        if os.path.exists(candidate):
            return candidate
    return os.path.join(_WEIGHTS_DIRS[0], weights)


def _ensure_custom_weights(path: str, url: str) -> None:
    if os.path.exists(path):
        return
    import urllib.request

    log.info("Downloading custom weights to %s ...", path)
    tmp = path + ".part"
    try:
        urllib.request.urlretrieve(url, tmp)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    log.info("Custom weights downloaded (%d bytes)", os.path.getsize(path))


def _get_yolo_model(weights: str):
    """Load (and cache) the YOLO model for ``weights``, reloading when the
    requested weights change. This lets the UI swap nano/small/medium live via
    the 'weights' param without restarting the worker. The load may auto-download
    the weights and take a few seconds; it happens under a lock on the detection
    thread, blocking only that one frame."""
    global _yolo_model, _yolo_weights_loaded, _yolo_classes_by_name
    weights = _resolve_weights(weights)
    if _yolo_model is not None and _yolo_weights_loaded == weights:
        return _yolo_model
    with _yolo_lock:
        if _yolo_model is None or _yolo_weights_loaded != weights:
            from ultralytics import YOLO  # lazy — pulls torch

            url = CUSTOM_WEIGHTS_URLS.get(os.path.basename(weights))
            if url:
                _ensure_custom_weights(weights, url)
            log.info("Loading YOLO weights: %s", weights)
            _yolo_model = YOLO(weights)  # auto-downloads ultralytics assets
            _yolo_weights_loaded = weights
            _yolo_classes_by_name = None
            if YOLO_CLASS_NAMES:
                ids = [
                    i
                    for i, name in _yolo_model.names.items()
                    if any(cn in str(name).lower() for cn in YOLO_CLASS_NAMES)
                ]
                if ids:
                    _yolo_classes_by_name = ids
                    log.info(
                        "Classes matching %s: %s",
                        sorted(YOLO_CLASS_NAMES),
                        {i: _yolo_model.names[i] for i in ids},
                    )
                else:
                    # Detecting everything beats silently detecting nothing.
                    log.warning(
                        "No class in %s matches %s (names=%s) — detecting all",
                        weights,
                        sorted(YOLO_CLASS_NAMES),
                        _yolo_model.names,
                    )
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


# ── Tiled (SAHI-style) inference ─────────────────────────────────────────────
# A bird a dozen pixels tall vanishes when the whole frame is squeezed to the
# model's input size. Tiling runs the model on overlapping crops instead, so
# each crop keeps far more native pixels per bird.

TILE_GRIDS = {"off": (1, 1), "2x2": (2, 2), "3x2": (3, 2)}  # (cols, rows)
TILE_OVERLAP = 0.2  # fraction of tile size shared with the neighbor
NMS_IOU = 0.45  # cross-tile duplicate suppression


def _iter_tiles(w: int, h: int, cols: int, rows: int, overlap: float):
    """Yield (x1, y1, x2, y2) pixel crops of a cols×rows grid with the given
    overlap; the last row/column is clamped to the frame edge so coverage is
    complete and all tiles are equal-sized (batchable)."""
    tile_w = int(np.ceil(w / (cols - (cols - 1) * overlap)))
    tile_h = int(np.ceil(h / (rows - (rows - 1) * overlap)))
    step_x = max(1, int(tile_w * (1 - overlap)))
    step_y = max(1, int(tile_h * (1 - overlap)))
    for r in range(rows):
        y1 = min(r * step_y, max(0, h - tile_h))
        for c in range(cols):
            x1 = min(c * step_x, max(0, w - tile_w))
            yield x1, y1, min(x1 + tile_w, w), min(y1 + tile_h, h)


def _nms(boxes: np.ndarray, scores: np.ndarray, iou_thr: float) -> list[int]:
    """Greedy NMS over [N,4] xyxy boxes; returns kept indices."""
    order = np.argsort(scores)[::-1]
    keep: list[int] = []
    while order.size:
        i = order[0]
        keep.append(int(i))
        rest = order[1:]
        if not rest.size:
            break
        xx1 = np.maximum(boxes[i, 0], boxes[rest, 0])
        yy1 = np.maximum(boxes[i, 1], boxes[rest, 1])
        xx2 = np.minimum(boxes[i, 2], boxes[rest, 2])
        yy2 = np.minimum(boxes[i, 3], boxes[rest, 3])
        inter = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
        area_i = (boxes[i, 2] - boxes[i, 0]) * (boxes[i, 3] - boxes[i, 1])
        area_r = (boxes[rest, 2] - boxes[rest, 0]) * (
            boxes[rest, 3] - boxes[rest, 1]
        )
        iou = inter / np.maximum(area_i + area_r - inter, 1e-9)
        order = rest[iou <= iou_thr]
    return keep


def _dets_from_results(results) -> list[np.ndarray]:
    """Per-image [N,5] arrays of (x1, y1, x2, y2, conf) in image-local pixels."""
    out: list[np.ndarray] = []
    for r in results:
        if r.boxes is None or len(r.boxes) == 0:
            out.append(np.zeros((0, 5), dtype=np.float32))
            continue
        xyxy = np.asarray(r.boxes.xyxy.tolist(), dtype=np.float32)
        # Guard for the rare case where a backend yields boxes without scores.
        conf = (
            np.asarray(r.boxes.conf.tolist(), dtype=np.float32)
            if r.boxes.conf is not None
            else np.zeros(len(xyxy), dtype=np.float32)
        )
        out.append(np.concatenate([xyxy, conf[:, None]], axis=1))
    return out


# ── Motion fusion ────────────────────────────────────────────────────────────
# A motion-blurred bird in flight is invisible to YOLO but is a strong frame-
# to-frame difference signal. When enabled, small moving blobs YOLO missed are
# appended to the detections with a low synthetic confidence.

MOTION_SCALE_W = 480  # diff on a downscaled gray frame — costs a few ms
MOTION_DIFF_THRESH = 18  # absdiff threshold (0-255)
MOTION_DILATE = 2  # dilation iterations (3x3 kernel) to close blob gaps
MOTION_GLOBAL_FRAC = 0.15  # more of the frame moving = camera pan/shake, skip
MOTION_MAX_GAP_S = 1.5  # stale baseline → reset instead of diffing across it
MOTION_SYNTH_CONF = 0.15  # below the birds' default conf 0.2, so the drawn
#                           conf label alone identifies a motion-only box
MOTION_SUPPRESS_IOU = 0.10  # blob overlapping a YOLO box this much is its halo


def _motion_boxes(
    state: InputState,
    gray_small: np.ndarray,
    now: float,
    min_frac: float,
    max_frac: float,
) -> list[tuple[float, float, float, float]]:
    """Boxes (normalized x, y, w, h) around small moving blobs, via frame
    differencing against the previous processed frame(s)."""
    prev, prev2 = state.prev_gray, state.prev2_gray
    stale = now - state.prev_gray_at > MOTION_MAX_GAP_S
    state.prev2_gray = None if stale else prev
    state.prev_gray = gray_small
    state.prev_gray_at = now
    if prev is None or stale or prev.shape != gray_small.shape:
        return []
    mask = cv2.absdiff(gray_small, prev) > MOTION_DIFF_THRESH
    if prev2 is not None and prev2.shape == gray_small.shape:
        # Double difference: at our slow cadence a plain 2-frame diff marks
        # both where the bird IS and where it WAS; requiring change against
        # both baselines keeps only the current position (and partially
        # cancels repetitive back-and-forth sway like leaves in wind).
        mask &= cv2.absdiff(gray_small, prev2) > MOTION_DIFF_THRESH
    if mask.mean() > MOTION_GLOBAL_FRAC:
        return []
    mask_u8 = cv2.dilate(
        mask.astype(np.uint8) * 255,
        np.ones((3, 3), np.uint8),
        iterations=MOTION_DILATE,
    )
    contours, _ = cv2.findContours(
        mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    sh, sw = gray_small.shape[:2]
    out = []
    for c in contours:
        x, y, bw, bh = cv2.boundingRect(c)
        wn, hn = bw / sw, bh / sh
        # Size gate: too small is sensor/compression noise, too big is a
        # swaying tree crown or a walking person — neither is a bird.
        if min_frac <= max(wn, hn) <= max_frac:
            out.append((x / sw, y / sh, wn, hn))
    return out


def _suppressed_by_yolo(
    mx: float, my: float, mw: float, mh: float, yolo_boxes: list[dict]
) -> bool:
    """A blob overlapping a YOLO detection (or centered inside one) is that
    bird's own motion halo — the wing-flap area around it — not a new bird."""
    cx, cy = mx + mw / 2, my + mh / 2
    for b in yolo_boxes:
        if b["x"] <= cx <= b["x"] + b["w"] and b["y"] <= cy <= b["y"] + b["h"]:
            return True
        ix = max(0.0, min(mx + mw, b["x"] + b["w"]) - max(mx, b["x"]))
        iy = max(0.0, min(my + mh, b["y"] + b["h"]) - max(my, b["y"]))
        inter = ix * iy
        union = mw * mh + b["w"] * b["h"] - inter
        if union > 0 and inter / union >= MOTION_SUPPRESS_IOU:
            return True
    return False


def _fuse_motion_boxes(
    state: InputState, rgb: np.ndarray, params: dict, boxes: list[dict]
) -> None:
    """Append motion-only blob boxes to ``boxes`` (in place)."""
    h, w = rgb.shape[:2]
    small_h = max(1, round(h * MOTION_SCALE_W / w))
    gray_small = cv2.cvtColor(
        cv2.resize(rgb, (MOTION_SCALE_W, small_h)), cv2.COLOR_RGB2GRAY
    )
    min_frac = float(params.get("motionMin", 0.004))
    max_frac = float(params.get("motionMax", 0.08))
    yolo_boxes = list(boxes)
    for mx, my, mw, mh in _motion_boxes(
        state, gray_small, time.monotonic(), min_frac, max_frac
    ):
        if _suppressed_by_yolo(mx, my, mw, mh, yolo_boxes):
            continue
        boxes.append(
            {
                "x": round(mx, 4),
                "y": round(my, 4),
                "w": round(mw, 4),
                "h": round(mh, 4),
                "conf": MOTION_SYNTH_CONF,
                "src": "motion",
            }
        )


# ── Marker keying ────────────────────────────────────────────────────────────
# For pre-marked footage: a video editor burned a saturated rectangle around
# each bird, so there is nothing to infer — find the rectangles. This is exact
# and frame-synchronous by construction (we read the very frame the output will
# present), which is the entire reason it beats replaying recorded coordinates.

# Analysed at native resolution on purpose. Downscaling first is the obvious
# optimization and it is a trap: INTER_AREA averages a thin stroke with the
# background behind it, so a 4px marker loses roughly half its colour dominance
# and compressed footage stops keying at any threshold that still rejects a warm
# sky. Measured on 1080p, full-res is also ~3x *faster* end to end, because the
# resize plus the contiguous copy it needs cost more than the extra pixels do.
# The cap only exists so a pathological frame can't blow up the budget; 4K is
# ~19ms and stays under it deliberately, because 4K is the common case here.
MARKER_MAX_W = 4096
# Per marker colour: the channel indices that must be high, and those that must
# be low. Matching by channel dominance (min(high) - max(low)) is one saturating
# uint8 op per channel, needs no hue-wraparound special case the way HSV does
# for red, and separates a saturated marker from merely warm scenery by the one
# thing that actually differs — how far the dominance goes.
MARKER_CHANNELS = {
    "red": ((0,), (1, 2)),
    "green": ((1,), (0, 2)),
    "blue": ((2,), (0, 1)),
    "magenta": ((0, 2), (1,)),
    "cyan": ((1, 2), (0,)),
    "yellow": ((0, 1), (2,)),
}
# Hex spellings that mean exactly one of the channel maps above. A fully
# saturated primary keys better by channel dominance than by hue (no division,
# no meaningless hue on near-grey pixels), so those keep the tuned fast path and
# only genuinely custom colours fall through to hue matching.
MARKER_CANONICAL_HEX = {
    "#ff0000": "red",
    "#00ff00": "green",
    "#0000ff": "blue",
    "#ff00ff": "magenta",
    "#00ffff": "cyan",
    "#ffff00": "yellow",
}
# Hue half-window, in OpenCV units (0-179 covers 360°), at tolerance 0. Widened
# by the tolerance slider. 13 units ~ 26°, which separates orange from red.
MARKER_HUE_WINDOW = 13.0
# Hue is meaningless for near-grey and near-black pixels, so a custom colour also
# has to clear a share of the target's own saturation and value.
MARKER_SAT_FLOOR = 0.45
MARKER_VAL_FLOOR = 0.35
# tolerance -> dominance threshold, as a fraction of full scale. The default
# (0.22 -> ~121/255) is the value that survives h264 down to JPEG q10 while
# still rejecting a sunset-orange background; lower it to catch dim or badly
# compressed markers, raise it when the scene itself is red.
MARKER_THRESH_BASE = 0.636
MARKER_THRESH_SLOPE = 0.727
# Band thickness used by the rectangle test, as a fraction of the shorter side.
# Deliberately thin: a circle inscribed in its own bbox only reaches into a thin
# top band near the centre (~0.54 coverage) while a rectangle covers it fully.
MARKER_EDGE_BAND = 0.08
MARKER_EDGE_MIN = 0.75  # weakest side must still be this covered
MARKER_ASPECT = 6.5  # reject slivers (rectangles are boxes, not lines)
MARKER_MIN_PX = 6  # absolute floor, below which the bbox is noise
# How square-cornered a hole has to be to count as a marker interior. A
# rectangle fills its own bbox (1.0); an ellipse manages 0.79.
MARKER_HOLE_FILL = 0.86
# Weak threshold as a fraction of the strict one, for the hysteresis pass.
MARKER_HYST_RATIO = 0.45
# Cap on how far the stroke-thickness probe walks out from a hole. Only used
# for crossing markers now (the parent contour gives the exact bounds
# otherwise), and kept tight because a runaway walk inflates the box.
MARKER_STROKE_MAX = 0.15
_marker_last_log = 0.0
# Per-call record of every candidate shape and why it was kept or dropped.
# Diagnostics only: read by marker_probe.py --explain, never by the worker, so
# the fact that two inputs detecting at once would interleave entries here does
# not affect detection.
_marker_report: list[dict] = []
# Count of components holding more than one hole on the last call — markers that
# merged in the mask. Diagnostics only, same caveat as _marker_report.
_marker_merged = 0


def _parse_marker_color(value: str) -> tuple[str, object]:
    """Resolve a marker colour into a keying strategy.

    Returns ``("channels", (pos, neg))`` for the six fully saturated primaries
    and secondaries — by name or by hex — and ``("hue", (h, s, v))`` in OpenCV
    HSV units for anything else the colour picker can produce.
    """
    v = str(value).strip().lower()
    if v in MARKER_CHANNELS:
        return "channels", MARKER_CHANNELS[v]
    if not v.startswith("#"):
        v = "#" + v
    if len(v) == 4:  # #rgb -> #rrggbb
        v = "#" + "".join(c * 2 for c in v[1:])
    if len(v) != 7 or any(c not in "0123456789abcdef" for c in v[1:]):
        return "channels", MARKER_CHANNELS["red"]
    if v in MARKER_CANONICAL_HEX:
        return "channels", MARKER_CHANNELS[MARKER_CANONICAL_HEX[v]]
    rgb = np.uint8([[[int(v[1:3], 16), int(v[3:5], 16), int(v[5:7], 16)]]])
    h, s, val = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)[0][0]
    return "hue", (int(h), int(s), int(val))


def _marker_score(frame: np.ndarray, color: str, tol: float) -> np.ndarray:
    """How strongly each pixel matches the marker colour, as uint8 0-255.

    Both strategies produce the same kind of image, so thresholding, hysteresis
    and every shape test downstream stay identical regardless of how the colour
    was specified.
    """
    kind, spec = _parse_marker_color(color)
    if kind == "channels":
        pos, neg = spec
        # Split once (cheap, SIMD) so every channel is a contiguous plane
        # OpenCV can work on; the alpha plane is ignored.
        channels = cv2.split(frame)[:3]
        low = channels[pos[0]]
        for i in pos[1:]:
            low = cv2.min(low, channels[i])
        high = channels[neg[0]]
        for i in neg[1:]:
            high = cv2.max(high, channels[i])
        # Saturating subtract: anything where the "low" channels aren't actually
        # dominant clamps to 0 instead of wrapping around.
        return cv2.subtract(low, high)

    target_h, target_s, target_v = spec
    hsv = cv2.cvtColor(
        frame if frame.shape[2] == 3 else cv2.cvtColor(frame, cv2.COLOR_RGBA2RGB),
        cv2.COLOR_RGB2HSV,
    )
    hue, sat, val = cv2.split(hsv)
    # The score depends only on the hue byte, so precompute all 256 answers and
    # let one LUT pass do the work. This also makes the circular distance free:
    # red sits at both ends of the scale, and a plain difference would read
    # #ff0000 and a hair off it as opposites.
    window = MARKER_HUE_WINDOW * (1.0 + 2.0 * tol)
    table = np.zeros(256, np.uint8)
    for hv in range(256):
        d = abs(hv - target_h) % 180
        d = min(d, 180 - d)
        table[hv] = max(0, min(255, int(round(255 * (1.0 - d / window)))))
    score = cv2.LUT(hue, table)
    gate = cv2.bitwise_and(
        cv2.threshold(
            sat, max(25, int(target_s * MARKER_SAT_FLOOR)), 255, cv2.THRESH_BINARY
        )[1],
        cv2.threshold(
            val, max(25, int(target_v * MARKER_VAL_FLOOR)), 255, cv2.THRESH_BINARY
        )[1],
    )
    return cv2.bitwise_and(score, gate)


def _marker_threshold(tol: float) -> int:
    """Colour-dominance threshold (0-255) for a tolerance slider value."""
    frac = MARKER_THRESH_BASE - MARKER_THRESH_SLOPE * tol
    return int(round(255 * min(1.0, max(0.02, frac))))


def _marker_tolerance_for(dominance: int) -> float:
    """The tolerance that would just admit a marker of this peak dominance.

    The inverse of _marker_threshold, so a probe can turn "the best the clip
    manages is 96" into a number to type into the slider.
    """
    frac = max(0.0, min(1.0, dominance / 255.0))
    return max(0.05, min(0.6, (MARKER_THRESH_BASE - frac) / MARKER_THRESH_SLOPE))


def _stroke_out(mask: np.ndarray, x: int, y: int, bw: int, bh: int) -> tuple[int, ...]:
    """Thickness of the marker stroke on each side of a hole (l, t, r, b).

    Walks outward from each edge for as long as the mask stays set. The hole is
    the *inside* of the drawn rectangle, so reporting it as-is would put the
    overlay inside the marker; this recovers the outer bounds, which is what the
    drawn outline has to cover.

    Each side is sampled at several points and the median is taken. A single
    probe is only as good as the pixel it starts from: where the marker touches
    anything else keyed the same colour, that one walk runs to the cap and
    inflates the box on that side. A drawn rectangle has a uniform stroke, so
    the outlier loses the vote.
    """
    limit = max(2, int(round(MARKER_STROKE_MAX * min(bw, bh))))
    h, w = mask.shape[:2]

    def walk(dx: int, dy: int, px: int, py: int) -> int:
        n = 0
        cx, cy = px + dx, py + dy
        while 0 <= cx < w and 0 <= cy < h and n < limit and mask[cy, cx]:
            n += 1
            cx += dx
            cy += dy
        return n

    def side(dx: int, dy: int, along_x: bool) -> int:
        span, base = (bw, x) if along_x else (bh, y)
        picks = []
        for f in (0.2, 0.35, 0.5, 0.65, 0.8):
            at = base + int(span * f)
            px = at if along_x else (x if dx < 0 else x + bw - 1)
            py = (y if dy < 0 else y + bh - 1) if along_x else at
            picks.append(walk(dx, dy, px, py))
        return int(statistics.median(picks))

    return (
        side(-1, 0, along_x=False),
        side(0, -1, along_x=True),
        side(1, 0, along_x=False),
        side(0, 1, along_x=True),
    )


def _marker_detect(
    rgba: np.ndarray, params: dict, state: "InputState | None" = None
) -> tuple[int, list[dict]]:
    """Find colour-keyed marker rectangles. Returns (count, boxes) in the same
    normalized wire shape as the YOLO backend.

    Markers are usually drawn on one keyframe per second rather than on every
    frame, so a frame with nothing on it does not mean the birds are gone. When
    ``state`` is given, the last seen markers are held for ``hold`` seconds, and
    only a genuinely stale latch clears the overlay.
    """
    global _marker_last_log

    tol = float(params.get("tolerance", 0.22))
    min_size = float(params.get("minSize", 0.01))
    max_size = float(params.get("maxSize", 0.5))
    pad = float(params.get("pad", 0.0))
    color = str(params.get("markerColor", "#ff0000"))

    frame = rgba
    if rgba.shape[1] > MARKER_MAX_W:
        scale = MARKER_MAX_W / rgba.shape[1]
        frame = cv2.resize(
            rgba,
            (MARKER_MAX_W, max(1, int(round(rgba.shape[0] * scale)))),
            interpolation=cv2.INTER_AREA,
        )
    h, w = frame.shape[:2]

    dominance = _marker_score(frame, color, tol)
    thresh = _marker_threshold(tol)

    # Hysteresis, the same idea Canny uses for edges. One flat threshold has to
    # be strict enough to reject warm scenery, and a stroke's edge pixels never
    # survive that: 4:2:0 stores colour at half resolution, so a thin saturated
    # line gets its chroma averaged with whatever is behind it and its edges
    # fade. The ring then fails to close and the marker is lost.
    #
    # So: find cores at the strict threshold, and grow them into a permissive
    # mask, but only as far as a dilation reaches. A genuine marker recovers its
    # bled edges; a warm background never contains a core to grow from, and
    # cannot flood in from elsewhere because growth is distance-limited.
    core = cv2.threshold(dominance, thresh, 255, cv2.THRESH_BINARY)[1]
    halo = cv2.threshold(
        dominance, max(12, int(thresh * MARKER_HYST_RATIO)), 255, cv2.THRESH_BINARY
    )[1]
    # Just wide enough to bridge chroma bleed (1-2px at any sane resolution).
    # Scaling this with the frame instead buys no extra recall and pushes the
    # reported edge outward by however far the halo happens to reach.
    grow = 5
    mask = cv2.bitwise_and(
        cv2.dilate(core, cv2.getStructuringElement(cv2.MORPH_RECT, (grow, grow))),
        halo,
    )

    # A thin stroke broken up by quantization falls apart into disconnected
    # segments — CLOSE puts the ring back together. Kept small and capped: a
    # kernel scaled to a 4K frame would happily weld two neighbouring markers
    # into one blob, which is worse than a gap.
    k = min(9, max(3, (int(round(min(h, w) * 0.004)) | 1)))
    mask = cv2.morphologyEx(
        mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    )
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

    # Detect the *holes*, not the strokes. Two markers that overlap merge into a
    # single ring-shaped blob whose outer bbox spans both and is not a rectangle
    # — outer-contour detection loses both of them. Their interiors stay two
    # separate holes, so each marker survives being crossed by its neighbour.
    # A filled marker has no hole and is picked up by the outer-contour pass.
    contours, hierarchy = cv2.findContours(
        mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE
    )
    hierarchy = hierarchy[0] if hierarchy is not None else []

    # Two markers drawn crossing each other merge into one ring whose interior
    # is chopped into several holes, and each fragment then reports as a box too
    # small for the marker it came from. Nothing here can tell the fragments
    # apart from small markers, so say so rather than silently mis-sizing.
    children: dict[int, int] = {}
    for idx in range(len(contours)):
        parent = hierarchy[idx][3]
        if parent != -1:
            children[parent] = children.get(parent, 0) + 1
    merged = sum(1 for n in children.values() if n > 1)
    global _marker_merged
    _marker_merged = merged

    rects = [cv2.boundingRect(c) for c in contours]

    boxes: list[dict] = []
    rejected = ""
    holes = 0
    _marker_report.clear()
    for idx, cnt in enumerate(contours):
        parent = hierarchy[idx][3]
        is_hole = parent != -1
        has_hole = hierarchy[idx][2] != -1
        # Outer contours that do enclose a hole are the stroke of a marker we
        # already report from the inside; skip them so nothing is counted twice.
        if not is_hole and has_hole:
            continue
        bl, bt, bw, bh = rects[idx]
        if is_hole:
            holes += 1
        if bw < MARKER_MIN_PX or bh < MARKER_MIN_PX:
            rejected = rejected or f"too small ({bw}x{bh}px)"
            _marker_report.append({"kind": "hole" if is_hole else "blob",
                                   "px": (bw, bh), "verdict": "too small"})
            continue

        area = cv2.contourArea(cnt)
        fill = area / float(bw * bh) if bw and bh else 0.0
        if is_hole:
            # A hand-drawn rectangle fills its own bbox, which is what keeps a
            # red ring in the scenery from reading as a marker. Judge the ring's
            # OUTER boundary as well and take the better of the two: anything
            # reddish inside the marker (dry grass, a warm-lit bird) eats into
            # the interior and drags the inner measure down, while the outer
            # boundary sits against the background and stays clean.
            pfill = 0.0
            if parent >= 0:
                px, py, pw, ph = rects[parent]
                if pw and ph:
                    pfill = cv2.contourArea(contours[parent]) / float(pw * ph)
            best = max(fill, pfill)
            if best < MARKER_HOLE_FILL:
                rejected = (
                    rejected
                    or f"not rectangular (inner {fill:.2f}, outer {pfill:.2f})"
                )
                _marker_report.append({"kind": "hole", "px": (bw, bh),
                                       "inner_fill": round(fill, 3),
                                       "outer_fill": round(pfill, 3),
                                       "verdict": "not rectangular"})
                continue
            fill = best
            # The stroke's outer edge is exactly the parent contour's bbox — no
            # measuring needed, as long as the parent wraps this hole alone.
            # Probing outward instead (the obvious approach) reads any adjacent
            # red-ish pixel as more stroke and inflates the box on that side.
            if children.get(parent, 0) == 1:
                bl, bt, bw, bh = rects[parent]
            else:
                left, top, right, bottom = _stroke_out(mask, bl, bt, bw, bh)
                bl -= left
                bt -= top
                bw += left + right
                bh += top + bottom
            # Both routes can overshoot: the parent outline comes from the grown
            # mask, which reaches a few pixels past the stroke wherever the
            # background is warm enough to pass the weak threshold, and the probe
            # rounds up to whole pixels. The strong-signal mask is the stroke
            # itself, so trim back to that — it can only shrink the box.
            bl, bt = max(0, bl), max(0, bt)
            bw, bh = min(bw, w - bl), min(bh, h - bt)
            rx, ry, rw, rh = cv2.boundingRect(core[bt:bt + bh, bl:bl + bw])
            if rw and rh:
                bl, bt, bw, bh = bl + rx, bt + ry, rw, rh
        else:
            # Filled marker: same edge-band test as before — project each edge
            # band onto its axis and ask whether it spans the whole side. A
            # block scores ~1.0, a red roof or sunset blob leaves the bbox
            # corners empty and fails on at least one side.
            roi = np.zeros((bh, bw), np.uint8)
            cv2.drawContours(roi, [cnt], -1, 255, cv2.FILLED, offset=(-bl, -bt))
            comp = roi > 0
            band = max(1, int(round(MARKER_EDGE_BAND * min(bw, bh))))
            sides = [
                float(comp[:band, :].max(axis=0).mean()),
                float(comp[-band:, :].max(axis=0).mean()),
                float(comp[:, :band].max(axis=1).mean()),
                float(comp[:, -band:].max(axis=1).mean()),
            ]
            # A marker running off the frame is the common case at the edges of
            # a shot: its ring never closes, so it lands here rather than in the
            # hole path, and the side that is off-screen can never be full. Only
            # judge the sides actually inside the frame — but keep needing at
            # least two of them, so a stray blob touching the border still has
            # to look like a rectangle to get in.
            visible = [
                s
                for s, off in zip(sides, (bt > 0, bt + bh < h, bl > 0, bl + bw < w))
                if off
            ]
            if len(visible) < 2:
                visible = sides
            if min(visible) < MARKER_EDGE_MIN:
                rejected = (
                    rejected or f"not rectangular (weakest side {min(visible):.2f})"
                )
                _marker_report.append({"kind": "blob", "px": (bw, bh),
                                       "weakest_side": round(min(visible), 3),
                                       "clipped": len(visible) < 4,
                                       "verdict": "not rectangular"})
                continue

        rel = max(bw / w, bh / h)
        if rel < min_size or rel > max_size:
            rejected = rejected or f"size {rel:.3f} outside [{min_size}, {max_size}]"
            _marker_report.append({"kind": "hole" if is_hole else "blob",
                                   "px": (bw, bh), "rel": round(rel, 4),
                                   "verdict": f"size outside "
                                              f"[{min_size}, {max_size}]"})
            continue
        aspect = bw / bh
        if aspect > MARKER_ASPECT or aspect < 1.0 / MARKER_ASPECT:
            rejected = rejected or f"aspect {aspect:.2f}"
            _marker_report.append({"kind": "hole" if is_hole else "blob",
                                   "px": (bw, bh), "aspect": round(aspect, 2),
                                   "verdict": "aspect"})
            continue
        _marker_report.append({"kind": "hole" if is_hole else "blob",
                               "px": (bw, bh), "rel": round(rel, 4),
                               "verdict": "ACCEPTED"})

        x = bl / w - pad
        y = bt / h - pad
        bwn = bw / w + 2 * pad
        bhn = bh / h + 2 * pad
        x = min(max(0.0, x), 1.0)
        y = min(max(0.0, y), 1.0)
        boxes.append(
            {
                "x": round(x, 4),
                "y": round(y, 4),
                "w": round(max(0.0, min(bwn, 1.0 - x)), 4),
                "h": round(max(0.0, min(bhn, 1.0 - y)), 4),
                # Synthetic confidence for the drawn label: drawn fresh each
                # keyframe so it fluctuates like a live detector's score
                # instead of sitting at a suspiciously flat value. The
                # interpolator lerps between keyframes, so the label glides
                # rather than flickering.
                "conf": round(random.uniform(0.65, 1.0), 3),
                # Render-colour enum only: 'motion' draws amber, anything else
                # green (see SmoothedBoxes.tsx) — nothing here came from YOLO.
                "src": "yolo",
            }
        )

    now = time.monotonic()
    if merged and now - _marker_last_log > 3.0:
        _marker_last_log = now
        log.info(
            "Markers: %d group(s) of rectangles cross each other — their boxes "
            "will come out fragmented. Leave a small gap between rectangles.",
            merged,
        )
    if boxes:
        if state is not None:
            state.marker_boxes = boxes
            state.marker_seen_at = now
            # Record the keyframe for interpolation. A gap far beyond the usual
            # cadence means a seam (mp4 loop, seek, long dry spell) — clear the
            # buffer so nothing glides across it.
            prev_t = (
                state.marker_keyframes[-1][0] if state.marker_keyframes else 0.0
            )
            if prev_t:
                gap = now - prev_t
                if state.marker_gap_ema and gap > max(
                    3.0, MARKER_GAP_RESET_FACTOR * state.marker_gap_ema
                ):
                    state.marker_keyframes.clear()
                    state.marker_gap_ema = 0.0
                elif gap > 1e-3:
                    state.marker_gap_ema = (
                        gap
                        if state.marker_gap_ema == 0.0
                        else 0.65 * state.marker_gap_ema + 0.35 * gap
                    )
            state.marker_keyframes.append((now, boxes))
    elif state is not None and state.marker_boxes:
        # Between keyframes: re-report the last markers rather than an empty
        # frame, which would retire every track and drop the ducks.
        hold_s = float(params.get("hold", 1.5))
        if now - state.marker_seen_at <= hold_s:
            return len(state.marker_boxes), state.marker_boxes
        state.marker_boxes = []

    if not boxes:
        if now - _marker_last_log > 3.0:
            _marker_last_log = now
            # The peak dominance separates the two ways this fails. Well above
            # the threshold means the colour was found and something later threw
            # it out (read the reason); at or below it, nothing in the frame is
            # that colour — wrong markerColor, or the tolerance is too strict.
            peak = int(dominance.max())
            log.info(
                "Markers: none accepted. peak colour dominance=%d vs threshold=%d, "
                "%d shape(s) (%d hole(s)), frame=%dx%d, first reason: %s. "
                "%s",
                peak,
                thresh,
                len(contours),
                holes,
                w,
                h,
                rejected or "nothing matched the colour",
                (
                    "Colour was found — check min/max marker size."
                    if peak > thresh
                    else "Colour NOT found — raise 'Colour tolerance' or "
                    "check 'Marker color'."
                ),
            )
    return len(boxes), boxes


def _match_marker_boxes(
    a_boxes: list[dict], b_boxes: list[dict], match_dist: float
) -> tuple[list[tuple[int, int]], list[int], list[int]]:
    """Pair boxes of one keyframe with the next by nearest centre, greedily.

    The gate is the user's 'Match distance', taken at face value: between
    keyframes a second apart a bird travels many times its own size, so a
    size-relative gate (like the Node tracker uses for its 30Hz updates)
    would block gliding for exactly the small fast birds it is meant for.
    Beyond the gate, two boxes are two birds and must pop rather than glide
    into each other.

    Returns (pairs [(i, j)], unmatched_a indices, unmatched_b indices).
    """
    cand: list[tuple[float, int, int]] = []
    for i, a in enumerate(a_boxes):
        ax, ay = a["x"] + a["w"] / 2, a["y"] + a["h"] / 2
        for j, b in enumerate(b_boxes):
            bx, by = b["x"] + b["w"] / 2, b["y"] + b["h"] / 2
            d = ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5
            if d <= match_dist:
                cand.append((d, i, j))
    cand.sort()
    used_a: set[int] = set()
    used_b: set[int] = set()
    pairs: list[tuple[int, int]] = []
    for _, i, j in cand:
        if i in used_a or j in used_b:
            continue
        used_a.add(i)
        used_b.add(j)
        pairs.append((i, j))
    un_a = [i for i in range(len(a_boxes)) if i not in used_a]
    un_b = [j for j in range(len(b_boxes)) if j not in used_b]
    return pairs, un_a, un_b


def _marker_interpolate(
    state: InputState, params: dict, now: float
) -> tuple[list[dict], float] | None:
    """Boxes for source-time ``s = now - lookback``, gliding between keyframes.

    Timing contract: the side channel hands the worker frames ``delayMs``
    before the output presents them, and Node holds each result by
    ``delay - procMs``. A result emitted now that reports
    ``procMs = now - s`` is therefore presented exactly at ``s + delay`` —
    so by describing a source-time one keyframe-gap in the past, both the
    keyframe before AND after ``s`` are already known and the box can be
    lerped between them. Returns (boxes, now - s) with ``now - s``
    recomputed after all clamping (the presentation only lands right if the
    reported lookback matches the boxes), or None when interpolation is not
    possible — the caller falls back to the latch/hold behaviour.
    """
    delay_s = float(params.get("delayMs", 0) or 0) / 1000.0
    kfs = list(state.marker_keyframes)
    gap = state.marker_gap_ema
    if not kfs or gap <= 0.0:
        return None  # fewer than 2 keyframes seen — nothing to glide between
    if delay_s < gap * 1.15 + MARKER_INTERP_MARGIN_S:
        if not state.marker_warned_delay:
            state.marker_warned_delay = True
            log.info(
                "Markers: model delay %.1fs is too small for the %.1fs keyframe "
                "gap — raise the delay to glide between keyframes; holding "
                "instead.",
                delay_s,
                gap,
            )
        return None
    state.marker_warned_delay = False
    lookback = min(
        gap * 1.25 + MARKER_LOOKBACK_PAD_S, delay_s - MARKER_LOOKBACK_CAP_PAD_S
    )
    s = now - lookback
    if s < kfs[0][0]:
        # Stream start (or tiny gaps): never present a box before its keyframe.
        s = kfs[0][0]
    if s >= kfs[-1][0]:
        # Keyframes stopped arriving — hold the newest for `hold` seconds of
        # source time, mirroring the latch, then let the overlay clear.
        hold_s = float(params.get("hold", 1.5))
        boxes = kfs[-1][1] if s - kfs[-1][0] <= hold_s else []
        return boxes, now - s

    # Bracketing pair: t[i] <= s < t[i+1].
    for (ta, a_boxes), (tb, b_boxes) in zip(kfs, kfs[1:]):
        if ta <= s < tb:
            break
    u = (s - ta) / (tb - ta)
    match_dist = float(params.get("matchDist", 0.12))
    pairs, un_a, _un_b = _match_marker_boxes(a_boxes, b_boxes, match_dist)
    out: list[dict] = []
    for i, j in pairs:
        a, b = a_boxes[i], b_boxes[j]
        box = {
            k: round(a[k] + (b[k] - a[k]) * u, 4) for k in ("x", "y", "w", "h")
        }
        box["conf"] = round(a["conf"] + (b["conf"] - a["conf"]) * u, 3)
        box["src"] = "yolo"
        out.append(box)
    # A bird that vanished stays frozen until its keyframe interval ends; a
    # bird that appeared in the newer keyframe waits until s reaches it.
    out.extend(a_boxes[i] for i in un_a)
    return out, now - s


def detect(
    rgba: np.ndarray, params: dict | None = None, state: InputState | None = None
) -> tuple[int, list[dict]]:
    """Detect people/faces in an RGBA frame. Returns (count, boxes) where boxes
    is a list of {x, y, w, h} normalized to 0..1 (only the YOLO backend emits
    boxes; face backends return an empty list). ``params`` carries per-input
    tunables (confidence, imgsz) with env values as fallback; ``state`` carries
    the per-input motion-fusion baselines."""
    params = params or {}
    # Marker mode short-circuits the backend entirely: the boxes are already in
    # the frame, so no model is loaded or run. Keys the full RGBA buffer — see
    # MARKER_MAX_W on why this path does not want the usual downscale.
    if str(params.get("source", "yolo")) == "markers":
        return _marker_detect(rgba, params, state)

    kind = _load_backend()
    rgb = rgba[:, :, :3]
    h, w = rgb.shape[:2]

    if kind == "yolo":
        # imgsz drives detection of small/distant people: 640 (default) is fast
        # but misses far figures; 1280 catches much more (slower on CPU). With
        # tiling on it applies per tile, multiplying the effective resolution.
        conf = float(params.get("confidence", YOLO_CONF))
        imgsz = int(params.get("imgsz", YOLO_IMGSZ))
        # 'weights' lets the UI switch model size (nano/s/m/custom) live.
        weights = str(params.get("weights") or YOLO_WEIGHTS)
        augment = str(params.get("augment", "off")) == "on"
        grid = TILE_GRIDS.get(str(params.get("tiles", "off")), (1, 1))
        model = _get_yolo_model(weights)
        classes = (
            _yolo_classes_by_name
            if YOLO_CLASS_NAMES
            else (params.get("classes") or YOLO_CLASSES)
        )

        if grid == (1, 1):
            results = model.predict(
                rgb,
                conf=conf,
                imgsz=imgsz,
                classes=classes,
                augment=augment,
                verbose=False,
            )
            dets = _dets_from_results(results)[0]
        else:
            cols, rows = grid
            crops, offsets = [], []
            for x1, y1, x2, y2 in _iter_tiles(w, h, cols, rows, TILE_OVERLAP):
                crops.append(np.ascontiguousarray(rgb[y1:y2, x1:x2]))
                offsets.append((x1, y1))
            # Equal-sized tiles go through one batched call; the full frame
            # runs separately on top — it catches large/close subjects that
            # tile seams would slice apart.
            tiled = model.predict(
                crops,
                conf=conf,
                imgsz=imgsz,
                classes=classes,
                augment=augment,
                verbose=False,
            )
            full = model.predict(
                rgb,
                conf=conf,
                imgsz=imgsz,
                classes=classes,
                augment=augment,
                verbose=False,
            )
            parts = []
            for det, (ox, oy) in zip(_dets_from_results(tiled), offsets):
                det[:, [0, 2]] += ox
                det[:, [1, 3]] += oy
                parts.append(det)
            parts.append(_dets_from_results(full)[0])
            dets = np.concatenate(parts, axis=0)
            if len(dets):
                dets = dets[_nms(dets[:, :4], dets[:, 4], NMS_IOU)]

        boxes: list[dict] = [
            {
                "x": round(max(0.0, x1 / w), 4),
                "y": round(max(0.0, y1 / h), 4),
                "w": round(max(0.0, (x2 - x1) / w), 4),
                "h": round(max(0.0, (y2 - y1) / h), 4),
                "conf": round(float(c), 4),
                "src": "yolo",
            }
            for x1, y1, x2, y2, c in dets.tolist()
        ]
        if state is not None and str(params.get("motion", "off")) == "on":
            _fuse_motion_boxes(state, rgb, params, boxes)
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
# After the fast retry budget is exhausted without a single frame, keep
# retrying at this slow cadence instead of dying permanently — mp4 inputs get
# no keepalive re-signal (unlike WHIP acks), so a restart race would otherwise
# kill detection until the model is toggled.
SUBSCRIBE_GIVEUP_RETRY_S = 5.0
# Pause before re-subscribing after a live stream drops mid-way (Smelter can
# close the side channel under load). Short so boxes barely blink.
RECONNECT_DELAY_S = 0.2
# subscribe_video_channel polls for the socket file with no deadline; if the
# file was unlinked after a re-bind (engine restart race) that poll would hang
# forever, silently. Abort the attempt instead so the retry ladder takes over.
FIRST_FRAME_TIMEOUT_S = 15.0


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

    # Outer loop: reconnect whenever a LIVE stream drops. Under load Smelter can
    # close the side channel mid-stream; while the input/model is still active
    # that's not a shutdown, so we re-subscribe instead of giving up. The tracker
    # keeps box identity across the gap, so boxes barely blink.
    while input_id in active_inputs:
        streamed = False
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
                    # Delivered frames and then ended — a mid-stream drop (or a
                    # normal teardown). Break to the outer loop, which reconnects
                    # only while the input is still active.
                    streamed = True
                    break
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
        if not streamed:
            log.warning(
                "no frames for %s after %d attempts — slow-retrying in %.0fs",
                input_id,
                SUBSCRIBE_MAX_RETRIES,
                SUBSCRIBE_GIVEUP_RETRY_S,
            )
            await asyncio.sleep(SUBSCRIBE_GIVEUP_RETRY_S)
            continue
        # A live stream dropped; reconnect if the input is still around.
        if input_id in active_inputs:
            log.info(
                "side channel for %s dropped mid-stream — reconnecting", input_id
            )
            await asyncio.sleep(RECONNECT_DELAY_S)
    # Only the task that owns the registry entry may clear it — a cancelled
    # old task must not evict its replacement (that would let start_detector
    # spawn a duplicate detector later).
    if running_tasks.get(input_id) is asyncio.current_task():
        running_tasks.pop(input_id, None)
    log.info("Stopped people counting for %s", input_id)


async def _run_detector_loop(input_id: str) -> int:
    """Read the video side channel and run detection.

    The socket reader and YOLO inference run as SEPARATE coroutines sharing a
    single-slot "latest frame" holder — this split is the whole point. Inference
    takes tens to hundreds of ms; if it ran inline in the read loop the socket
    would go undrained for that long. Smelter's side-channel writer uses a
    non-blocking socket (on macOS the accepted socket inherits the listener's
    non-blocking flag), so an undrained buffer fills, its write_all() fails, and
    Smelter drops the whole channel after a handful of frames — which froze the
    boxes between reconnects. Draining continuously on its own coroutine keeps
    the buffer empty; inference just consumes the most recent frame and lets the
    rest fall on the floor (we rate-limit output anyway).
    """
    frame_count = 0
    latest_frame = None
    latest_at = 0.0
    frame_ready = asyncio.Event()
    stopped = asyncio.Event()

    async def reader() -> None:
        nonlocal frame_count, latest_frame, latest_at
        try:
            async for frame in subscribe_video_channel(input_id):
                if input_id not in active_inputs or stopped.is_set():
                    break
                frame_count += 1
                if frame_count == 1:
                    log.info("First frame received for %s", input_id)
                # Overwrite: only the freshest frame matters for detection.
                latest_frame = frame
                # Wall time the frame was delivered (the side channel hands it
                # over ~delay_ms before the output presents it).
                latest_at = time.monotonic()
                frame_ready.set()
        finally:
            stopped.set()
            frame_ready.set()  # wake the consumer so it can notice and exit

    async def consumer() -> None:
        while not stopped.is_set():
            await frame_ready.wait()
            frame_ready.clear()
            if stopped.is_set():
                break
            frame = latest_frame
            delivered_at = latest_at
            if frame is None or input_id not in active_inputs:
                continue
            state = active_inputs[input_id]
            # Rate-limit inference/output; the reader keeps draining regardless.
            # Marker keying costs a few ms rather than YOLO's hundreds, and its
            # boxes are drawn without easing, so it runs near frame rate — at
            # the YOLO cadence the overlay would visibly step.
            interval = (
                MARKER_OUTPUT_INTERVAL_S
                if str(state.params.get("source", "yolo")) == "markers"
                else OUTPUT_INTERVAL_S
            )
            if delivered_at - state.last_output_at < interval:
                continue
            rgba = frame.rgba
            frame_h, frame_w = rgba.shape[:2]
            count, boxes = await asyncio.to_thread(detect, rgba, state.params, state)
            proc_ms = (time.monotonic() - delivered_at) * 1000.0
            # Marker glide: detect() above recorded any keyframe this frame
            # carried; re-time the emitted result to a source-time between two
            # seen keyframes and lerp the boxes. procMs carries the re-timing —
            # Node holds each result by (delay - procMs), so a result "about"
            # the past is presented exactly when its source frame is due.
            if (
                str(state.params.get("source", "yolo")) == "markers"
                and str(state.params.get("markerMotion", "interpolate"))
                == "interpolate"
            ):
                interp = _marker_interpolate(state, state.params, time.monotonic())
                if interp is not None:
                    boxes, lookback_s = interp
                    count = len(boxes)
                    proc_ms = lookback_s * 1000.0
            state.last_output_at = time.monotonic()
            await send_result(input_id, count, boxes, frame_w, frame_h, proc_ms)

    reader_task = asyncio.ensure_future(reader())
    consumer_task = asyncio.ensure_future(consumer())

    watchdog_fired = False

    async def watchdog() -> None:
        nonlocal watchdog_fired
        await asyncio.sleep(FIRST_FRAME_TIMEOUT_S)
        if frame_count == 0 and not stopped.is_set():
            watchdog_fired = True
            log.warning(
                "no first frame for %s within %.0fs — aborting attempt",
                input_id,
                FIRST_FRAME_TIMEOUT_S,
            )
            stopped.set()
            frame_ready.set()
            reader_task.cancel()

    watchdog_task = asyncio.ensure_future(watchdog())
    try:
        await asyncio.gather(reader_task, consumer_task)
    except asyncio.CancelledError:
        if watchdog_fired:
            # Not an external cancel — the watchdog aborted a subscribe stuck
            # waiting on a socket that will never appear. Report 0 frames so
            # run_detector's retry ladder handles it.
            return frame_count
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
        # Stop whichever coroutine is still alive so neither leaks past the loop.
        stopped.set()
        frame_ready.set()
        for task in (reader_task, consumer_task, watchdog_task):
            if not task.done():
                task.cancel()
        await asyncio.gather(
            reader_task, consumer_task, watchdog_task, return_exceptions=True
        )
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
