# YOLO Side-Channel Server

A FastAPI server that subscribes to Smelter's per-input **side channel** sockets,
runs YOLOv8 on every frame, and POSTs detected boxes back to the editor server.

This replaces the previous HLS / OpenCV pipeline. Because side channels are
**per-input** (verified — see [`SIDE_CHANNEL.md`](./SIDE_CHANNEL.md)), every
detection task targets exactly one Smelter input, so several models can run
concurrently on different inputs / layers.

## Directory layout

```
ai_plugins/
├── README.md                # This file
├── SIDE_CHANNEL.md          # Full side-channel reference (protocol + SDK)
├── yolo_server.py           # FastAPI server (entry point)
├── requirements_yolo.txt    # Python dependencies
└── models/                  # 📁 Drop your YOLOv8 .pt files here
```

The first `.pt` file found in `models/` becomes the default. Specify
`model_name` on `/start` to use a different one.

## Setup

```bash
cd ai_plugins
pip install -r requirements_yolo.txt
# Place at least one YOLOv8 .pt file in ./models/
```

## Running the server

The Python process must see the same `SMELTER_SIDE_CHANNEL_SOCKET_DIR` that the
Smelter Node server set. The editor's Node server prints the directory on
startup; either run uvicorn from the same shell, or pass the variable
explicitly:

```bash
SMELTER_SIDE_CHANNEL_SOCKET_DIR=/tmp/smelter-sidechan-XXXXXX \
  uvicorn yolo_server:app --host 0.0.0.0 --port 8765
```

`--reload` is handy in development.

## API

### `GET /models`

```json
{ "models": ["yolov8n.pt", "best.pt"] }
```

### `GET /model-info?model_name=...`

```json
{ "classes": ["person", "car"], "model_file": "...", "num_classes": 80 }
```

### `GET /channels?socket_dir=...`

Lists side-channel sockets currently visible. Useful for debugging — confirms
Smelter has actually created the socket you're about to subscribe to.

```json
{
  "socket_dir": "/tmp/smelter-sidechan-XXXX",
  "channels": [
    { "kind": "video", "input_id": "room1::whip::abcd", "path": "..." }
  ]
}
```

### `POST /start`

```json
{
  "input_id": "room1::whip::abcd",
  "callback_url": "http://127.0.0.1:3001/.../yolo-boxes",
  "class_filter": "person",
  "confidence": 0.4,
  "task_id": "stable-id",
  "model_name": "best.pt",
  "socket_dir": "/tmp/smelter-sidechan-XXXX"
}
```

Only `input_id` and `callback_url` are required. The server spawns a
background thread that waits for `video_<input_id>.sock` to appear, opens
it, runs the model on each RGBA frame, and POSTs boxes to `callback_url`.

Callback body:

```json
{
  "task_id": "...",
  "input_id": "room1::whip::abcd",
  "boxes": [
    {
      "x": 10, "y": 20, "width": 100, "height": 200,
      "class_name": "person", "class_id": 0, "confidence": 0.87
    }
  ],
  "frame_width": 1280,
  "frame_height": 720,
  "pts_nanos": 12345678
}
```

Box coordinates are in **input pixel** space (not the composed scene). The
editor's server normalises them to `[0, 1]` of the input frame.

### `POST /stop`

```json
{ "task_id": "..." }
```

### `GET /health`

```json
{ "status": "ok", "active_tasks": ["..."], "socket_dir": "..." }
```

## How it ties into the editor

1. `server/src/smelter.tsx` creates a private side-channel socket dir at boot
   and sets `SMELTER_SIDE_CHANNEL_SOCKET_DIR` before initialising Smelter.
2. Video inputs (whip / mp4 / hls) are registered with
   `sideChannel: { video: true }`, so Smelter creates a unix socket per input.
3. `server/src/yolo/YoloController.ts` calls `/start` with the input's
   `input_id` whenever the user enables YOLO Search on that input.
4. Boxes flow back through the `/yolo-boxes` callback and are stored on
   `RoomInputState.yoloBoundingBoxes`.

See [`SIDE_CHANNEL.md`](./SIDE_CHANNEL.md) for the full wire-protocol /
SDK reference.

## Troubleshooting

- **`/start` returns 200 but no boxes flow** — check `/channels` to confirm
  the input's `video_<input_id>.sock` is visible in the right socket dir.
  Mismatched `SMELTER_SIDE_CHANNEL_SOCKET_DIR` between Node and Python is the
  most common cause.
- **`ChannelNotFound`** — the input was never registered with
  `sideChannel: { video: true }`, or the input was unregistered before the
  Python task could attach.
- **"No model found"** — drop a YOLOv8 `.pt` file into `ai_plugins/models/`.
- **Frames are dropped** — Smelter's per-client outbound queue is depth-1 for
  video. If inference is slower than the source frame rate, frames are
  skipped. That's by design.
