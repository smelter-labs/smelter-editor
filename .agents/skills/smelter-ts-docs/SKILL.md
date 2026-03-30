---
name: smelter-ts-docs
description: >
  Comprehensive reference for building applications with the Smelter TypeScript SDK (@swmansion/smelter).
  Smelter is a media processing framework that uses React components to define video/audio compositions.
  Use this skill when the user is building, debugging, or extending a Smelter TypeScript application,
  asking about Smelter components, hooks, inputs, outputs, resources, or choosing between runtime packages
  (@swmansion/smelter-node, @swmansion/smelter-web-client, @swmansion/smelter-web-wasm).
  Triggers: "smelter", "@swmansion/smelter", video composition in TypeScript/React,
  mixing video streams, RTMP streaming with Smelter, video processing pipeline with React.
---

# Smelter TypeScript SDK

Smelter is a video/audio composition framework using React components to define scenes. You write React JSX describing the layout; Smelter renders it as actual video frames.

## Version mismatch

This documentation refers to `^0.4.0` version of the smelter packages. When encountering API errors such as missing fields, nonexistent properties, unexpected types, or deprecated options, read `package.json` and check if this project is using the correct version.

If there is a version mismatch, inform the user about the **actions** they can take to resolve it and **finish the answer immediately**.
→ For detailed instructions on what **actions** the user can take: `references/update.md`

## Core Concept

```tsx
// Define a scene as React JSX
function MyScene() {
  return (
    <View style={{ width: 1920, height: 1080 }}>
      <InputStream inputId="input_1" />
    </View>
  );
}

// Wire it to actual media
await smelter.registerOutput("main", <MyScene />, { type: "rtmp_client", url: "..." });
```

## Runtime Packages — Choose One

| Package | Use when | Details |
|---|---|---|
| `@swmansion/smelter-node` | Server-side Node.js app | Auto-spawns Smelter binary; live + offline modes |
| `@swmansion/smelter-web-client` | Browser app, external server | Connects to deployed Smelter server; live + offline modes |
| `@swmansion/smelter-web-wasm` | Browser app, no server | Runs Smelter as WASM in Web Worker; Chrome only |

→ For detailed setup and API for each runtime: `references/runtimes/nodejs.md`, `references/runtimes/web-client.md`, `references/runtimes/web-wasm.md`

## Components

Import from `@swmansion/smelter`:

```tsx
import { View, Text, InputStream, Tiles, Rescaler, Image, Mp4, Shader, Show, SlideShow, WebView } from "@swmansion/smelter";
```

### Layout Components

| Component | Summary | When to use |
|---|---|---|
| **View** | Core container, like `<div>` | Structure any layout; supports absolute and static positioning, overflow, background color |
| **Tiles** | A layout component that arranges all children side by side in equally sized, non-overlapping tiles, automatically calculating optimal rows/columns. | Multi-stream grids (e.g., video conferencing layout, side by side layouts). Use as default for multiple inputs if user does not specify a layout explicitly. |
| **Rescaler** | Scales single child to fit, preserving aspect ratio | Fit any stream/content into a fixed area |

→ `references/components/View.md`, `references/components/Tiles.md`, `references/components/Rescaler.md`

### Media Components

| Component | Summary | When to use |
|---|---|---|
| **InputStream** | Displays a registered input stream | Show any registered input (camera, RTP, RTMP, WHIP, etc.) |
| **Mp4** | Plays MP4 file directly (no registration needed) | Simple one-off MP4 playback without registration overhead |
| **Image** | Renders an image (URL or registered asset) | Static images, logos, overlays |
| **Shader** | Renders output of a WGSL GPU shader | Custom visual effects, chroma key, color grading |
| **WebView** | Renders a live website via Chromium | Embedding web-based graphics or interactive content |

→ `references/components/InputStream.md`, `references/components/Mp4.md`, `references/components/Image.md`, `references/components/Shader.md`, `references/components/WebView.md`

### Utility Components

| Component | Summary | When to use |
|---|---|---|
| **Text** | Renders styled text | Whenever stream needs to display text, specifically for lower thirds, captions, labels, titles, etc. |
| **Show** | Conditionally shows children based on timestamp | Scheduling elements in offline processing |
| **SlideShow** | Sequences `<Slide>` children one after another | Intro/outro sequences, sequential content |

→ `references/components/Text.md`, `references/components/Show.md`, `references/components/SlideShow.md`

## Props (Styling)

| Props Type | Used by | Summary |
|---|---|---|
| **ViewStyleProps** | `<View>` | Width/height, direction (row/column), absolute positioning, overflow, background, padding |
| **TextStyleProps** | `<Text>` | fontSize (required), font family/weight/style, color, alignment, wrapping |
| **TilesStyleProps** | `<Tiles>` | Width/height, tile aspect ratio, margin, padding, alignment |
| **RescalerStyleProps** | `<Rescaler>` | Rescaling mode (fit/fill), alignment, absolute positioning |
| **Transition** | `<View>`, `<Tiles>`, `<Rescaler>` | Animated scene updates with duration and easing |
| **EasingFunction** | `Transition` | `"linear"`, `"bounce"`, or custom `cubic_bezier` |

→ `references/props/ViewStyleProps.md`, `references/props/TextStyleProps.md`, `references/props/TilesStyleProps.md`, `references/props/RescalerStyleProps.md`, `references/props/Transition.md`, `references/props/EasingFunction.md`

## Hooks

| Hook | Summary | When to use |
|---|---|---|
| **useInputStreams()** | Returns state of all registered inputs | Conditionally render based on stream status (ready/playing/finished) - TODO: Change |
| **useAudioInput(id, opts)** | Controls audio for an input without rendering it visually | Background audio mixing without visual component |
| **useAfterTimestamp(ms)** | Returns `true` once a timestamp passes | Time-based scene changes in offline processing |
| **useBlockingTask(fn)** | Runs async fn, blocks offline rendering until resolved | Load remote data before offline rendering proceeds |

→ `references/hooks/useInputStreams.md`, `references/hooks/useAudioInput.md`, `references/hooks/useAfterTimestamp.md`, `references/hooks/useBlockingTask.md`

## Inputs

Registered via `smelter.registerInput(id, options)`. Returns an `InputHandle` with methods for runtime control (`pause()`, `resume()`, and `seek()` for MP4). Displayed via `<InputStream inputId="id" />`.

| Input type | Runtime | Use when |
|---|---|---|
| `mp4` | All | Play a local/remote MP4 file |
| `rtp_stream` | Node.js, Web Client | Receive RTP stream over UDP/TCP |
| `hls` | Node.js | Consume HLS playlist |
| `whip_server` | Node.js, Web Client | Accept WebRTC stream via WHIP protocol |
| `whep_client` | Node.js, Web Client | Pull stream from WHEP server |
| `rtmp_server` | Node.js, Web Client | Accept RTMP/RTMPS stream (OBS, FFmpeg) |
| `v4l2` | Node.js, Web Client | Capture video via V4L2 API (Linux) — experimental |
| `camera` | WASM only | Browser camera via `getUserMedia()` |
| `screen_capture` | WASM only | Browser screen capture via `getDisplayMedia()` |
| `stream` | WASM only | Any `MediaStream` object |
| `whep_client` (WASM) | WASM only | Pull from WHEP server in browser |

→ Full details: `references/inputs.md`

## Outputs

Registered via `smelter.registerOutput(id, <ReactRoot />, options)`.

| Output type | Runtime | Use when |
|---|---|---|
| `mp4` | Node.js, Web Client | Save to MP4 file |
| `rtp_stream` | Node.js, Web Client | Stream over RTP |
| `hls` | Node.js, Web Client | Stream over HLS. User will need to handle serving the files on their own. |
| `whip_client` | Node.js, Web Client | Push via WebRTC WHIP |
| `whep_server` | Node.js, Web Client | Serve via WebRTC WHEP to multiple viewers |
| `rtmp_client` | Node.js, Web Client | Push to RTMP server (YouTube, Twitch) |
| `canvas` | WASM only | Render to `HTMLCanvasElement` |
| `stream` | WASM only | Return a `MediaStream` |
| `whip_client` (WASM) | WASM only | Push via WebRTC WHIP from browser |

→ Full details: `references/outputs.md`

## Resources

Pre-registered assets used by components.

| Resource | Registered via | Used by component |
|---|---|---|
| Image | `smelter.registerImage(id, opts)` | `<Image imageId="id" />` |
| Shader | `smelter.registerShader(id, opts)` | `<Shader shaderId="id" />` |
| WebRenderer | `smelter.registerWebRenderer(id, opts)` | `<WebView instanceId="id" />` |
| Font | `smelter.registerFont(source)` | `<Text>` components |

→ Full details: `references/resources.md`


## Patterns & Best Practices

Real-world patterns for building Smelter apps:

| Pattern | Summary |
|---|---|
| **Shader Wrapping** | Recursively nest `<Shader>` components to chain multiple effects |
| **Input State Rendering** | Use `useInputStreams()` for spinner/offline/playing conditional rendering |
| **Animations via Timers** | `setInterval` + React state for swap transitions, marquee, fades |
| **Shader Color Params** | Convert hex colors to per-channel `f32` fields (`_r`, `_g`, `_b`) |
| **Multi-Output Shared Store** | Same store for WHEP live + MP4 recording = identical output |
| **Scrolling Text** | Animate `<View>` position inside `overflow: 'hidden'` container |

→ Full details and code examples: `references/patterns.md`
