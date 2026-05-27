# Smelter Side Channel — Reference

The **side channel** is a Smelter feature that exposes decoded video frames and
PCM audio batches from a registered input over a Unix-domain socket. It lets an
external process (typically Python for ML inference) consume the raw stream
straight out of Smelter's queue — *before* compositing — without going through
HLS / WebRTC / re-encoding.

This document describes the wire-level protocol, the public Python SDK
(`smelter-sdk`), and how the Smelter editor uses it for YOLO detection.

---

## 1. How it works

```
Smelter (Rust)                            Python process
─────────────────                         ─────────────────
input "cam1"  ──►  /tmp/.../video_cam1.sock  ◄── smelter.subscribe_video_channel("cam1")
                                                    │
                                                    ▼
                                               YOLO / Whisper / …
```

1. Smelter is started with the env var
   `SMELTER_SIDE_CHANNEL_SOCKET_DIR=/some/dir`. (Optionally
   `SMELTER_SIDE_CHANNEL_DELAY_MS=<ms>` to delay rendered output by N ms so the
   external process has time to process a frame before it appears on the WHEP
   output.)
2. An input is registered with `sideChannel: { video: true, audio: true }`
   (either or both flags). Smelter binds a Unix socket per enabled track:
   - `video_<input_id>.sock`
   - `audio_<input_id>.sock`
3. Any number of processes may `connect()` to those sockets. Smelter
   **broadcasts** each frame / batch to every connected client (see
   `smelter-core/src/queue/side_channel/server.rs` → `broadcast_to_client_threads`).
   This means multiple subscribers per input are supported — e.g. one process
   doing YOLO, another doing Whisper.
4. Frames flow as length-prefixed binary messages. Wire format is documented
   below and parsed by `smelter-sdk` for you.

### Per-input scope (verified)

The side channel is **strictly per-input**. There is no global side channel,
no per-output side channel. Each input that opts in gets its own pair of
sockets, named after that input's `input_id`. Multiple inputs in the same
pipeline therefore produce multiple independent sockets:

```
/tmp/smelter-sidechan-XXX/
├── video_cam1.sock      # input "cam1"
├── audio_cam1.sock
├── video_screenshare.sock   # input "screenshare"
└── ...
```

This is why the editor can run a different YOLO model (or no model at all) per
input/layer — each subscription targets one socket.

---

## 2. Wire format

Both video and audio messages are framed with a **4-byte big-endian u32**
length prefix. Numeric values inside the payload are also big-endian. Source:
`smelter-core/src/queue/side_channel/serialize.rs`.

### Video message

| Offset | Type | Field |
| ------ | ---- | ----- |
| 0      | u32  | `width` |
| 4      | u32  | `height` |
| 8      | u64  | `pts_nanos` |
| 16     | u8[width × height × 4] | `rgba_data` (row-major; R, G, B, A) |

- Always RGBA. The smelter wgpu pipeline converts whatever the decoder
  produced into 8-bit RGBA before writing it to the socket.
- `pts_nanos` is in the queue's clock — zero at queue start, monotonic per
  input, accounting for track offsets.

### Audio message

| Offset | Type | Field |
| ------ | ---- | ----- |
| 0      | u64  | `start_pts_nanos` |
| 8      | u32  | `sample_rate` |
| 12     | u8   | `channel_count` (1 mono, 2 stereo) |
| 13     | u32  | `sample_count` (samples per channel) |
| 17     | f64[sample_count × channel_count] | samples (big-endian) |

- Mono layout: `[s0, s1, …]`
- Stereo layout: `[l0, r0, l1, r1, …]`
- Sample values are in `[-1.0, 1.0]`.

### Buffering and drop policy

| Track | In-process capacity (frames/batches) | On full |
| ----- | ----- | ----- |
| Video | 1     | Newest frame dropped (`dropping frame, channel full`) |
| Audio | 10    | Newest batch dropped |

The server thread also has a per-client outbound queue with the same capacity.
**A slow consumer cannot block Smelter** — it will just see frames skipped.

---

## 3. Python SDK (`smelter-sdk`)

Source: `~/projects/smelter/sdks/python/lib/smelter/`. Installed via
`pip install smelter-sdk>=0.4.0`.

Both sync and async APIs are provided; they are 1:1 mirrors.

### Discovery

```python
from smelter import list_channels, SideChannelKind

for c in list_channels():
    print(c.kind, c.input_id, c.path)
# SideChannelKind.VIDEO  cam1            /tmp/.../video_cam1.sock
# SideChannelKind.AUDIO  cam1            /tmp/.../audio_cam1.sock
```

`list_channels()` reads `SMELTER_SIDE_CHANNEL_SOCKET_DIR` from the
environment (or accepts an explicit `ctx=Context(socket_dir=…)`). Sockets
not matching the `<kind>_<input_id>.sock` naming convention are ignored.

### Subscribing

High-level one-call form (recommended):

```python
from smelter import subscribe_video_channel, subscribe_audio_channel

for frame in subscribe_video_channel("cam1"):
    # frame.rgba : np.ndarray, shape (h, w, 4), dtype uint8, writable
    # frame.pts_nanos, frame.pts_seconds, frame.width, frame.height
    run_inference(frame.rgba)

for batch in subscribe_audio_channel("cam1"):
    # batch.samples : np.ndarray, shape (n_samples, channels), dtype float32
    # batch.sample_rate, batch.start_pts_nanos, batch.channels, batch.to_mono()
    ...
```

Asyncio:

```python
from smelter.aio import subscribe_video_channel

async for frame in subscribe_video_channel("cam1"):
    await asyncio.to_thread(run_inference, frame.rgba)
```

`wait_for_channel(kind=…, input_id=…, timeout=…)` is the lower-level primitive
the `subscribe_*` helpers wrap. Use it directly if you need a custom
connection lifecycle.

### Lower-level connections

```python
from smelter import connect_video, wait_for_channel, SideChannelKind

info = wait_for_channel(kind=SideChannelKind.VIDEO, input_id="cam1")
with connect_video(info) as conn:
    conn.set_timeout(2.0)        # per-recv timeout
    frame = conn.recv()
```

### Errors

| Exception | Meaning |
| --------- | ------- |
| `ChannelNotFound` | `wait_for_channel` timeout elapsed |
| `ConnectionClosed` | Smelter closed the socket (input unregistered, server shut down) |
| `RecvTimeout` | Per-`recv` timeout fired |
| `ProtocolError` | Wire format violation — usually means smelter and SDK versions mismatched |

---

## 4. What you can / can't do with it

**Can:**

- Stream raw decoded RGBA frames from any input (`mp4`, `hls`, `whip_server`,
  `whep_client`, `rtmp_server`, `rtp_stream`, `v4l2`, etc.) into Python.
- Stream PCM audio batches (per-input, pre-mix) into Python.
- Connect multiple subscribers to the same input socket — Smelter broadcasts.
- Run different processing per input (one input → YOLO COCO, another input →
  face detector, another → Whisper).
- Mutate `frame.rgba` in place (the buffer is writable and owned by you) — but
  this does *not* feed anything back into Smelter; the socket is read-only
  from Smelter's perspective.

**Can't:**

- Push frames *into* Smelter via the side channel. The channel is one-way
  (Smelter → external). To feed processed video back, you need a separate
  Smelter input (e.g. another WHIP push, or an `mp4` file on disk).
- Get a guarantee of delivery. Frames are dropped under back-pressure (video
  capacity = 1, audio = 10). For lossless processing you must keep up with
  the source rate.
- Discover sockets cross-process without sharing the socket dir. The directory
  is communicated via `SMELTER_SIDE_CHANNEL_SOCKET_DIR`, which must be set
  before Smelter starts.
- Use it on platforms without Unix-domain sockets (Windows currently
  unsupported by this feature).

---

## 5. How the Smelter editor uses it

`server/src/smelter.tsx` creates a private socket directory (`mkdtempSync`)
once at boot and sets `SMELTER_SIDE_CHANNEL_SOCKET_DIR` on `process.env`
before instantiating Smelter. Inputs that need ML inference are registered
with `sideChannel: { video: true }`.

`server/src/yolo/YoloController.ts` then drives the Python server at
`ai_plugins/yolo_server.py`:

- `POST /start` — tells Python which `input_id` to subscribe to, plus model,
  class filter, confidence, and a `callback_url` to POST detections to. The
  controller passes the active socket directory so the Python process resolves
  the same sockets Smelter is writing to.
- `POST /stop` — tells Python to cancel the subscription for a given
  `task_id`.

Detection callbacks (`POST /room/:roomId/input/:inputId/yolo-boxes`) are then
fanned out by `RoomState.receiveYoloBoxes → YoloController.receiveBoxes`,
which normalises the coordinates to `[0, 1]` of the **input** frame and stores
them on `RoomInputState.yoloBoundingBoxes`.

> **Note on box coordinates:** because the side channel delivers per-input
> frames (not the composed output), bounding boxes are normalised relative to
> the *input's* native resolution. The scene renderer currently treats them
> as scene-space; positioning relative to the input's on-scene rectangle is
> a follow-up.

The Python process is started independently
(`uvicorn yolo_server:app --host 0.0.0.0 --port 8765`) and reads the same
`SMELTER_SIDE_CHANNEL_SOCKET_DIR` from its environment. Run it from a shell
that inherits the variable, or pass it explicitly:

```bash
SMELTER_SIDE_CHANNEL_SOCKET_DIR=/tmp/smelter-sidechan-XXXXXX \
  uvicorn yolo_server:app --host 0.0.0.0 --port 8765
```

---

## 6. Quick reference

| Thing | Value |
| ----- | ----- |
| Socket directory env var | `SMELTER_SIDE_CHANNEL_SOCKET_DIR` |
| Render delay env var     | `SMELTER_SIDE_CHANNEL_DELAY_MS` (optional, default 0) |
| Video socket name        | `video_<input_id>.sock` |
| Audio socket name        | `audio_<input_id>.sock` |
| Length prefix            | 4-byte big-endian u32 |
| Video payload            | u32 w, u32 h, u64 pts_ns, RGBA bytes |
| Audio payload            | u64 pts_ns, u32 sr, u8 ch, u32 nsamp, f64 samples |
| Multi-client?            | Yes — broadcast |
| Back-pressure            | Dropped frames/batches |
| Python SDK               | `pip install smelter-sdk>=0.4.0` |
| TS opt-in flag           | `sideChannel: { video: true, audio: true }` on the input |
