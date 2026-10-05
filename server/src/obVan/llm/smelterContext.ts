/**
 * OB Van LLM — the Smelter study pack handed to Smelterionaire's AI
 * contestants (and nothing else: no question-specific retrieval, so a
 * contestant can still be confidently wrong on air, which is the show).
 *
 * Curated by hand from `.agents/skills/smelter-ts-docs/` and the
 * smelter.dev docs (fundamentals + TS SDK), ~4k tokens. Chat models get it
 * as the system prompt (cached via `cache_control: ephemeral` on Anthropic);
 * Jev gets it prepended to its `state`.
 */
export const OB_QUIZ_SMELTER_CONTEXT = `# Smelter — study notes

## What it is
Smelter is a toolkit for real-time video processing built by Software Mansion.
It combines multimedia from different sources (live streams, files, cameras,
websites) into a single video or live stream, enriched with text, custom
shaders and embedded websites. Scenes are described either with React
components (TypeScript SDK) or directly via an HTTP API; the engine itself is
written in Rust and renders the React tree as actual video frames on the GPU
(wgpu). A standalone server is available as binaries and as the Docker image
ghcr.io/software-mansion/smelter. There is also a Membrane Framework plugin
(Elixir). A starter project comes from \`npx create-smelter-app\`.

## Processing modes and time
- Live processing: any real-time input or output; processing is synchronized
  to the wall clock (1 s of video takes about 1 s to process).
- Offline processing: only non-real-time inputs/outputs (e.g. combining two
  MP4 files); runs as fast as the hardware allows, decoupled from real time.
- Timestamps are in milliseconds, measured from the queue start, in stream
  time (not wall-clock time).
- An input registered with \`required: true\` blocks output until its data for
  the current timestamp is available. Rule of thumb: all inputs required in
  offline mode, none required in live mode.
- \`offsetMs\` sets an input's start relative to the queue start; without it
  the offset comes from the arrival time of the first packet.

## Runtime packages (choose one)
- @swmansion/smelter-node — server-side Node.js; auto-spawns the Smelter
  binary; live + offline.
- @swmansion/smelter-web-client — browser app talking to an externally
  deployed Smelter server; live + offline.
- @swmansion/smelter-web-wasm — Smelter compiled to WASM running in a Web
  Worker, no server needed; Chrome only.
The shared component/hook package is @swmansion/smelter.

## Core API
- \`smelter.registerInput(id, options)\` → InputHandle (pause()/resume();
  Mp4InputHandle adds seek(ms); WhipInputHandle exposes endpointRoute and
  bearerToken). Shown in a scene with \`<InputStream inputId="id" />\`.
- \`smelter.registerOutput(id, <ReactRoot />, options)\` — each output gets
  its own React root.
- Resources are registered before use: \`registerImage\`, \`registerShader\`,
  \`registerWebRenderer\`, \`registerFont\`. A "resource" is anything
  registered that is neither an input nor an output (shader, font, image).

## Components (import from @swmansion/smelter)
- View — the core container, like a <div>: row/column direction, absolute or
  static positioning, overflow, background color, padding.
- Tiles — arranges all children side by side in EQUAL-SIZED, non-overlapping
  tiles, automatically picking rows/columns from the component size, the
  tileAspectRatio (default 16:9) and the child count; placed left-to-right,
  top-to-bottom. Children cannot be absolutely positioned inside Tiles, and
  Tiles itself cannot be absolutely positioned. Its transition animates
  reorder/add/remove, not size.
- Rescaler — resizes exactly ONE child to its own size, always preserving the
  child's aspect ratio; style.rescaleMode is "fit" (default, may leave empty
  space) or "fill" (covers the area, may clip).
- InputStream — displays a registered input.
- Mp4 — plays an MP4 file directly with no registration step.
- Image — renders a URL or registered image asset.
- Shader — renders a user-provided WGSL shader registered via
  registerShader(); child components are available as textures inside the
  shader; requires a \`resolution\`; \`shaderParam\` is passed as the uniform
  at @group(1) @binding(0) and its memory layout (padding) is managed
  manually. On web-wasm a shader gets only one texture (texture_2d<f32>)
  instead of a binding_array of 16.
- WebView — renders a live website via embedded Chromium (needs a registered
  WebRenderer instance).
- Text — styled text; fontSize is required.
- Show — shows children based on a timestamp (offline scheduling).
- SlideShow — plays <Slide> children one after another.

## Transitions
\`transition: { durationMs, easingFunction?, shouldInterrupt? }\` on View,
Tiles and Rescaler animates scene updates. The component must keep the SAME
id in the old and new scene. Animatable fields: width/height and
top/bottom/left/right/rotation (the field must exist in both scenes). If the
positioning mode changes (absolute ↔ static) no transition is applied.
Easing: "linear" (default), "bounce", or a custom cubic_bezier.

## Hooks
- useInputStreams() — state of all registered inputs (ready/playing/finished)
  for conditional rendering.
- useAudioInput(id, opts) — mix an input's audio without rendering it.
- useAfterTimestamp(ms) — true once a timestamp passes (offline).
- useBlockingTask(fn) — blocks offline rendering until the async fn resolves.

## Inputs (registerInput \`type\`)
- "mp4" — H264 video + AAC audio, first tracks only; exactly one of \`url\`
  or \`serverPath\`; \`loop\` and \`required\` are Node-only; \`seekMs\`
  starts mid-file. On WASM, MP4 audio is not supported.
- "rtp_stream" — RTP over UDP or TCP server mode; video decoders
  ffmpeg_h264 / vulkan_h264 / ffmpeg_vp8 / ffmpeg_vp9; audio opus, or aac
  with an audioSpecificConfig hex string taken from the SDP.
- "hls" — consumes an HLS playlist (Node.js).
- "whip_server" — accepts WebRTC via WHIP; Smelter listens on port 9000
  (SMELTER_WHIP_WHEP_SERVER_PORT) at /whip/:input_id; bearerToken is
  auto-generated when omitted.
- "whep_client" — pulls a live stream from a WHEP server; only Opus audio.
- "rtmp_server" — accepts RTMP/RTMPS (OBS, FFmpeg) at
  rtmp://host:1935/<app>/<stream_key> (SMELTER_RTMP_SERVER_PORT; TLS via
  SMELTER_RTMP_TLS_CERT_FILE / SMELTER_RTMP_TLS_KEY_FILE).
- "v4l2" — experimental Linux camera capture (formats yuyv / nv12).
- WASM-only: "camera" (getUserMedia), "screen_capture" (getDisplayMedia),
  "stream" (any MediaStream), plus a WASM whep_client.
Updating: handle.pause()/resume()/seek(), or
\`smelter.api.updateInput(id, { pause, seek_ms })\` (seek is MP4-only).

## Outputs (registerOutput \`type\`)
mp4 (file), rtp_stream, hls, whip_client (push WebRTC), whep_server (serve
WebRTC to many viewers), rtmp_client (push to YouTube/Twitch). WASM-only:
canvas (HTMLCanvasElement) and stream (MediaStream).

## Patterns
- Chain effects by nesting <Shader> components (each child is a texture).
- Drive animations with setInterval + React state; scrolling text = animate a
  View's position inside an overflow:'hidden' container.
- Convert hex colors to per-channel f32 shader params (_r, _g, _b).
- Reuse one shared store across a WHEP live output and an MP4 recording
  output to make them identical.
- WGSL is the shader language (WebGPU Shading Language).
`;
