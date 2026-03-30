# Inputs Reference

Inputs are registered via `smelter.registerInput(id, options)`. The `type` field determines which kind of input is registered. Use `<InputStream inputId="id" />` to display a registered input in the scene.

## Table of Contents

- [Common Options](#common-options) — Common options appearing in multiple inputs
- [MP4](#mp4) — Node.js, Web Client, Web WASM
- [RTP](#rtp) — Node.js, Web Client
- [HLS](#hls) — Node.js
- [WHIP Server](#whip-server) — Node.js, Web Client
- [WHEP Client](#whep-client) — Node.js, Web Client
- [RTMP Server](#rtmp-server) — Node.js, Web Client
- [V4L2](#v4l2) — Node.js, Web Client (Experimental)
- [Camera (WASM)](#camera-wasm) — Web WASM only
- [Screen Capture (WASM)](#screen-capture-wasm) — Web WASM only
- [MediaStream (WASM)](#mediastream-wasm) — Web WASM only
- [WHEP Client (WASM)](#whep-client-wasm) — Web WASM only
- [Return Type: InputHandle](#return-type-inputhandle) — Handle returned from registerInput
- [Updating Inputs](#updating-inputs) — Pause, resume, seek via handle or low-level API

---

## Common Options

### required
When `true`, Smelter waits for this input before producing output frames.
- **Default**: `false`

### offsetMs
Timing offset relative to pipeline start. If unspecified, synced based on when first frames arrive.

### decoderMap / decoderPreferences
Controls which decoder to use:
- `"ffmpeg_h264"` — software H264 via FFmpeg
- `"vulkan_h264"` — hardware H264 via Vulkan (requires GPU support)
- `"ffmpeg_vp8"` / `"ffmpeg_vp9"` — software VP8/VP9 via FFmpeg
- `"any"` — auto-select any supported decoder

---

## MP4

Reads static MP4 files. Supports H264 video and AAC audio. Only first video/audio tracks used.

> **WASM**: Audio from MP4 NOT supported.

```tsx
type RegisterMp4Input = {
  type: "mp4";
  url?: string;          // Node.js, WASM
  serverPath?: string;   // Node.js only
  loop?: boolean;        // Node.js only, default: false
  required?: boolean;    // Node.js only, default: false
  offsetMs?: number;     // Node.js only
  seekMs?: number;       // Start from specific position (ms). With loop, resets to 0 after first iteration.
  decoderMap?: { h264?: 'ffmpeg_h264' | 'vulkan_h264' };
}
```

Exactly one of `url` or `serverPath` must be defined.

---

## RTP

Streams video/audio over RTP (UDP or TCP server mode).

```tsx
type RegisterRtpInput = {
  type: "rtp_stream";
  port: string | number;  // number or "START:END" range
  transportProtocol?: "udp" | "tcp_server";  // default: udp
  video?: { decoder: "ffmpeg_h264" | "vulkan_h264" | "ffmpeg_vp8" | "ffmpeg_vp9" };
  audio?: { decoder: "opus" } | { decoder: "aac"; audioSpecificConfig: string; rtpMode?: "low_bitrate" | "high_bitrate" };
  required?: boolean;
  offsetMs?: number;
}
```

At least one of `video` or `audio` must be defined.

For AAC audio, `audioSpecificConfig` is a hex string from the SDP file. Get it with:
```bash
ffmpeg -v 0 -i input.mp4 -t 0 -vn -c:a copy -sdp_file /dev/stdout -f rtp 'rtp://127.0.0.1:1111'
```
Look for `config=<HEX_STRING>` in the output.

---

## HLS

Consumes HLS playlists.

```tsx
type RegisterHlsInput = {
  type: "hls";
  url: string;
  required?: boolean;
  offsetMs?: number;
  decoderMap?: { h264?: 'ffmpeg_h264' | 'vulkan_h264' };
}
```

---

## WHIP Server

Provides a WHIP server endpoint for incoming WebRTC streams. Smelter listens on port 9000 (configurable via `SMELTER_WHIP_WHEP_SERVER_PORT`) at `/whip/:input_id`.

```tsx
type RegisterWhipServerInput = {
  type: "whip_server";
  video?: { decoderPreferences?: ("ffmpeg_h264" | "vulkan_h264" | "ffmpeg_vp8" | "ffmpeg_vp9" | "any")[] };
  bearerToken?: string;  // auto-generated if omitted
  required?: boolean;
  offsetMs?: number;
}
```

After registration, connect to `http://localhost:9000/whip/<inputId>`.

---

## WHEP Client

Connects to a WHEP server to receive a live stream. Only Opus audio supported. Video decoder auto-negotiated if no preferences given.

```tsx
type RegisterWhepClientInput = {
  type: "whep_client";
  endpointUrl: string;
  bearerToken?: string;
  video?: { decoderPreferences?: ("ffmpeg_h264" | "vulkan_h264" | "ffmpeg_vp8" | "ffmpeg_vp9" | "any")[] };
  required?: boolean;
  offsetMs?: number;
}
```

---

## RTMP Server

Receives RTMP/RTMPS streams. Smelter exposes an RTMP endpoint after registration. Push from OBS, FFmpeg, or any RTMP broadcaster.

Connection URL format: `rtmp[s]://<smelter_ip>:<port>/<app>/<stream_key>`

Port defaults to `1935`, configurable via `SMELTER_RTMP_SERVER_PORT`. For RTMPS, configure `SMELTER_RTMP_TLS_CERT_FILE` and `SMELTER_RTMP_TLS_KEY_FILE` env vars.

```tsx
type RegisterRtmpServerInput = {
  type: "rtmp_server";
  app: string;
  streamKey: string;
  required?: boolean;
  offsetMs?: number;
  decoderMap?: { h264?: 'ffmpeg_h264' | 'vulkan_h264' };
}
```

---

## V4L2

Experimental. Captures video using the Video for Linux 2 API. Linux only.

```tsx
type RegisterV4l2Input = {
  type: "v4l2";
  path: string;              // e.g., "/dev/video0"
  format: "yuyv" | "nv12";
  resolution: {
    width: number;
    height: number;
  };
  framerate: number | string; // number or "NUM/DEN" fraction
  required?: boolean;
}
```

V4L2 devices are found at paths like `/dev/video[N]`, `/dev/v4l/by-id/[DEVICE ID]`, or `/dev/v4l/by-path/[PCI/USB PATH]`. Supported formats: YUYV (interleaved 4:2:2 YUV) and NV12 (planar 4:2:0 YUV). Resolution and framerate may be adjusted by the device driver to the closest supported values.

---

## Camera (WASM)

Captures camera + microphone using `getUserMedia()`.

```tsx
await smelter.registerInput("cam", { type: "camera" });
```

---

## Screen Capture (WASM)

Captures screen output and audio using `getDisplayMedia()`.

```tsx
await smelter.registerInput("screen", { type: "screen_capture" });
```

---

## MediaStream (WASM)

Accepts any browser `MediaStream` object.

```tsx
const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
await smelter.registerInput("stream1", { type: "stream", stream });
```

---

## WHEP Client (WASM)

Connects to a WHEP server to receive a live media stream.

```tsx
type RegisterWhepClientInput = {
  type: "whep_client";
  endpointUrl: string;
  bearerToken?: string;
}
```

---

## Return Type: InputHandle

`registerInput` returns an `InputHandle` (or a type-specific subclass). The handle provides methods to control the input after registration.

```tsx
// Base InputHandle (returned for most input types)
class InputHandle {
  videoDurationMs?: number;  // MP4 only
  audioDurationMs?: number;  // MP4 only
  pause(): Promise<void>;
  resume(): Promise<void>;
}

// Returned when registering { type: "mp4" }
class Mp4InputHandle extends InputHandle {
  seek(seekMs: number): Promise<void>;  // Seek to position in milliseconds
}

// Returned when registering { type: "whip_server" }
class WhipInputHandle extends InputHandle {
  endpointRoute: string;
  bearerToken: string;
}
```

In `smelter-node` and `smelter-web-client`, the return type is overloaded per input type:
```tsx
registerInput(id, { type: "mp4", ... }): Promise<Mp4InputHandle>
registerInput(id, { type: "whip_server", ... }): Promise<WhipInputHandle>
registerInput(id, request): Promise<InputHandle>  // all others
```

---

## Updating Inputs

Registered inputs can be updated via the handle methods (`pause()`, `resume()`, `seek()`) or the low-level API:

```tsx
await smelter.api.updateInput(inputId, { pause: true });
await smelter.api.updateInput(inputId, { seek_ms: 5000 });  // MP4 only
```

`UpdateInputRequest`:
```tsx
interface UpdateInputRequest {
  pause?: boolean;    // Pause/unpause input playback
  seek_ms?: number;   // Seek to position in ms (MP4 only)
}
```
