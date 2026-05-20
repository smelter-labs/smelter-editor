---
name: smelter-editor-and-server
description: >
  Capability map for this repo's Smelter Editor (Next.js 15 / React 19 web app under `editor/`)
  and Smelter Server (Fastify + Smelter rendering engine under `server/`). Use this skill when
  working anywhere in `editor/` or `server/`, deciding whether a feature already exists,
  picking the right HTTP / WebSocket / SSE entry point, or extending UI surfaces such as the
  control panel, timeline, dashboard, or voice commands. Complements the upstream
  `smelter-ts-docs` skill, which covers the `@swmansion/smelter` SDK primitives this app
  builds on. Triggers: "smelter editor", "smelter server", "control panel", "timeline",
  "clip", "keyframe", "WHEP", "WHIP", "motion detection", "snake game", "voice commands",
  "shader preset", "room config", "dashboard layout", "what can the editor do",
  "what does the server expose".
---

# Smelter Editor + Server

The repo is a monorepo: `editor/` (Next.js 15 web UI) talks to `server/` (Fastify + Smelter compositing engine) over REST + WebSocket + SSE; the rendered output is delivered to viewers as WebRTC/WHEP and inbound camera/screenshare as WHIP. Shared types live in [packages/types/src/](packages/types/src/). For architecture and code patterns see [AGENTS.md](AGENTS.md); for setup and the high-level feature list see [README.md](README.md).

This file is a **capability inventory**: what operations exist, where they live, and how to invoke or extend them.

## How to read this file

- File references are clickable and point to the file in this repo (e.g. [editor/app/actions/actions.ts](editor/app/actions/actions.ts)).
- "Where in code" entries are jump-off points, not exhaustive lists. The pointed-at file usually re-exports or wraps the rest.
- Counts (35 shaders, 9 input types…) are pulled directly from source. If you change them, update this file.

## Overview map

| Layer | Entry point | Purpose |
|---|---|---|
| Editor pages | [editor/app/](editor/app/) | Next.js App Router — `/`, `/rooms`, `/room/[roomId]`, `/room-preview`, `/raw-preview`, `/kick/*` |
| Editor server actions | [editor/app/actions/actions.ts](editor/app/actions/actions.ts) | Single funnel for all HTTP calls to the server via `sendSmelterRequest()` |
| Control panel | [editor/components/control-panel/](editor/components/control-panel/) | The 87 KB `control-panel.tsx` plus components/, hooks/, contexts/, input-entry/ |
| Dashboard | [editor/components/dashboard/](editor/components/dashboard/) | react-grid-layout shell + panel registry + presets |
| Voice commands | [editor/lib/voice/](editor/lib/voice/) | Speech → intent parser → macro executor |
| Server routes (monolith) | [server/src/routing/routes.ts](server/src/routing/routes.ts) (2249 lines) | All HTTP + WebSocket + SSE registration |
| Server storage factory | [server/src/routing/storageRoutes.ts](server/src/routing/storageRoutes.ts) | Generic CRUD reused for 5 backends |
| Timeline routes plugin | [server/src/timeline/timelineRoutes.ts](server/src/timeline/timelineRoutes.ts) | Play / pause / seek / apply / SSE |
| Snake game routes plugin | [server/src/snakeGame/snakeGameRoutes.ts](server/src/snakeGame/snakeGameRoutes.ts) | Sticky-room game state push |
| Uploads plugin | [server/src/core/routes/uploadRoutes.ts](server/src/core/routes/uploadRoutes.ts) | Multipart upload for mp4/picture/audio/font |
| Smelter wrapper | [server/src/smelter.tsx](server/src/smelter.tsx) | Singleton `SmelterInstance`; manages outputs, inputs, images, shaders, motion output |
| Per-room state | [server/src/room/RoomState.ts](server/src/room/RoomState.ts) | All mutations go through here |
| Render tree | [server/src/app/App.tsx](server/src/app/App.tsx) | React 18 → video frames; layers + viewport + output shaders |

## Smelter SDK skill (`.agents/skills/smelter-ts-docs/`)

The upstream SDK reference for `@swmansion/smelter` is shipped as a local skill at [.agents/skills/smelter-ts-docs/SKILL.md](.agents/skills/smelter-ts-docs/SKILL.md). The repo's `server/` uses the Node.js runtime (`@swmansion/smelter-node`), so reach for this skill whenever you write JSX that renders to video — new layouts in [server/src/app/](server/src/app/), new components in [server/src/inputs/](server/src/inputs/) or [server/src/snakeGame/](server/src/snakeGame/), shader wiring, output registration, transitions, scene-time scheduling. The skill is pinned to upstream `@swmansion/smelter ^0.4.0` (see [skills-lock.json](skills-lock.json)); if you hit `package.json` showing a different major, follow [references/update.md](.agents/skills/smelter-ts-docs/references/update.md) before assuming a bug.

The skill's [SKILL.md](.agents/skills/smelter-ts-docs/SKILL.md) is the entry index — these are the deep-reference files it links into, with a one-line "reach for this when" for each:

### Components

| File | Reach for it when |
|---|---|
| [components/View.md](.agents/skills/smelter-ts-docs/references/components/View.md) | Building any layout — `<View>` is the core container (like `<div>`); covers absolute/static positioning, overflow, background |
| [components/Tiles.md](.agents/skills/smelter-ts-docs/references/components/Tiles.md) | Auto-arranging multiple children in equally-sized grid cells (rows/cols computed) — default for multi-stream layouts |
| [components/Rescaler.md](.agents/skills/smelter-ts-docs/references/components/Rescaler.md) | Fitting one child into a fixed area while preserving aspect ratio (fit / fill modes) |
| [components/InputStream.md](.agents/skills/smelter-ts-docs/references/components/InputStream.md) | Rendering a registered input — every `<Input>` in this repo wraps `<InputStream inputId="…" />` |
| [components/Mp4.md](.agents/skills/smelter-ts-docs/references/components/Mp4.md) | Playing an MP4 file inline without going through `registerInput` |
| [components/Image.md](.agents/skills/smelter-ts-docs/references/components/Image.md) | Static images / logos / overlays (URL or pre-registered asset) |
| [components/Shader.md](.agents/skills/smelter-ts-docs/references/components/Shader.md) | Wrapping content in a WGSL shader; this repo chains shaders via `wrapWithShaders()` in [server/src/utils/shaderUtils.tsx](server/src/utils/shaderUtils.tsx) |
| [components/Text.md](.agents/skills/smelter-ts-docs/references/components/Text.md) | Styled text — captions, lower thirds, the scrolling news strip, labels |
| [components/Show.md](.agents/skills/smelter-ts-docs/references/components/Show.md) | Conditionally rendering children based on timestamp (offline rendering) |
| [components/SlideShow.md](.agents/skills/smelter-ts-docs/references/components/SlideShow.md) | Sequencing `<Slide>` children for intros / outros |
| [components/WebView.md](.agents/skills/smelter-ts-docs/references/components/WebView.md) | Embedding a live website via Chromium (registered via `registerWebRenderer`) |

### Hooks

| File | Reach for it when |
|---|---|
| [hooks/useInputStreams.md](.agents/skills/smelter-ts-docs/references/hooks/useInputStreams.md) | Conditionally rendering on input state (ready / playing / finished); used by `<Input>` for spinner / offline / playing branches |
| [hooks/useAudioInput.md](.agents/skills/smelter-ts-docs/references/hooks/useAudioInput.md) | Mixing audio for an input without rendering it visually |
| [hooks/useAfterTimestamp.md](.agents/skills/smelter-ts-docs/references/hooks/useAfterTimestamp.md) | Firing a scene change after a timestamp passes (offline) |
| [hooks/useBlockingTask.md](.agents/skills/smelter-ts-docs/references/hooks/useBlockingTask.md) | Loading remote data before offline rendering proceeds |

### Style props

| File | Reach for it when |
|---|---|
| [props/ViewStyleProps.md](.agents/skills/smelter-ts-docs/references/props/ViewStyleProps.md) | Sizing / direction (row/column) / absolute positioning / overflow / background / padding on `<View>` |
| [props/TextStyleProps.md](.agents/skills/smelter-ts-docs/references/props/TextStyleProps.md) | `fontSize` (required), font family/weight, color, alignment, wrapping on `<Text>` |
| [props/TilesStyleProps.md](.agents/skills/smelter-ts-docs/references/props/TilesStyleProps.md) | Tile aspect ratio, margin, padding, alignment on `<Tiles>` |
| [props/RescalerStyleProps.md](.agents/skills/smelter-ts-docs/references/props/RescalerStyleProps.md) | Rescaling mode (fit / fill), alignment, absolute positioning on `<Rescaler>` |
| [props/Transition.md](.agents/skills/smelter-ts-docs/references/props/Transition.md) | Animated scene updates — duration + easing on `<View>` / `<Tiles>` / `<Rescaler>`; this repo's swap and viewport transitions feed `buildEasingFunction()` here |
| [props/EasingFunction.md](.agents/skills/smelter-ts-docs/references/props/EasingFunction.md) | Picking between `"linear"`, `"bounce"`, and custom `cubic_bezier` — matches the `transitionEasing` strings sent from the editor |

### Inputs / Outputs / Resources

| File | Reach for it when |
|---|---|
| [inputs.md](.agents/skills/smelter-ts-docs/references/inputs.md) | Adding or debugging a `registerInput` call — covers MP4, RTP, HLS, WHIP, WHEP, RTMP, V4L2 (Node), plus camera / screen / stream (WASM). The 9 server input types in this repo all funnel into these |
| [outputs.md](.agents/skills/smelter-ts-docs/references/outputs.md) | Adding or debugging a `registerOutput` call — MP4 / RTP / HLS / WHIP / WHEP / RTMP for Node, canvas / stream for WASM. This repo registers a WHEP output per room and an MP4 output for recordings |
| [resources.md](.agents/skills/smelter-ts-docs/references/resources.md) | Registering shared assets — `registerImage`, `registerShader`, `registerWebRenderer`, `registerFont`. This repo registers fonts on startup and shaders from the 35-entry catalog |

### Runtimes

| File | Reach for it when |
|---|---|
| [runtimes/nodejs.md](.agents/skills/smelter-ts-docs/references/runtimes/nodejs.md) | Anything in `server/` — this is the runtime we use; covers `@swmansion/smelter-node`, binary spawning, live + offline modes |
| [runtimes/web-client.md](.agents/skills/smelter-ts-docs/references/runtimes/web-client.md) | Hypothetical browser app talking to a deployed Smelter server — not used here, but relevant if a future editor renders inline |
| [runtimes/web-wasm.md](.agents/skills/smelter-ts-docs/references/runtimes/web-wasm.md) | Running Smelter as WASM in a Web Worker (Chrome only) — not used here |

### Patterns

| File | Reach for it when |
|---|---|
| [patterns.md](.agents/skills/smelter-ts-docs/references/patterns.md) | Looking for proven recipes — shader chaining via recursive `<Shader>`, input-state-conditional rendering, timer-driven swap/marquee animations, hex→f32 color conversion for shader params, multi-output shared store (live WHEP + MP4 recording from the same store — exactly the pattern this repo uses), scrolling text in `overflow: 'hidden'` |
| [update.md](.agents/skills/smelter-ts-docs/references/update.md) | The skill notes the API version drifted from this repo's `package.json` |

### Sibling skills (in [skills-lock.json](skills-lock.json) but not unpacked locally)

The lock file pins two more upstream skills that aren't checked into `.agents/skills/`:

| Skill | Source | When relevant |
|---|---|---|
| `reanimated-dnd` | `entropyconquers/react-native-reanimated-dnd` | Touch DnD for the React Native mobile app under [mobile_app/](mobile_app/) |
| `vercel-react-native-skills` | `vercel-labs/agent-skills` | Generic Vercel/React Native patterns for the mobile app |

If they're needed, fetch with the project's skill sync tooling rather than reading from the lock file.

## Server API

All HTTP routes are mounted on the Fastify instance in [server/src/routing/routes.ts](server/src/routing/routes.ts) unless noted otherwise. Default port: `SMELTER_DEMO_API_PORT=3001`. CORS open; multipart limit 500 MB per file.

### Rooms

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/active-rooms` | List `{ rooms: [{ roomId, roomName }] }` |
| `POST` | `/room` | Create room — body `{ initInputs?, skipDefaultInputs?, resolution? }`; returns `{ roomId, roomName, whepUrl, resolution }` |
| `GET` | `/room/:roomId` | Snapshot: inputs, layers, swap settings, viewport, output shaders, timeline-playing flag, recording flag, audio-analysis flag |
| `POST` | `/room/:roomId` | Update room — see `UpdateRoomSchema` ([routes.ts:1338](server/src/routing/routes.ts:1338)) |
| `DELETE` | `/room/:roomId` | Soft-delete (broadcasts `room_deleted`) |
| `GET` | `/rooms` | Admin HTML table (auto-refresh 2 s) |
| `POST` | `/restart-smelter` | Restart engine — gated by `ALLOW_SMELTER_RESTART` (403 otherwise) |

Soft limit 3 / hard limit 5 rooms. Exceeding soft limit auto-deletes the oldest inactive room after 20 s. Snake-game rooms are sticky and survive inactivity. Mutex serializes room creation.

### Inputs

`POST /room/:roomId/input` registers a new input. Body must match `InputSchema` ([routes.ts:829](server/src/routing/routes.ts:829)) — a union over **9 types**:

| Type | Required fields | Notes |
|---|---|---|
| `twitch-channel` | `channelId` | HLS via streamlink; Twitch OAuth in [server/src/twitch/](server/src/twitch/) |
| `kick-channel` | `channelId` | HLS via streamlink; Kick OAuth in [server/src/kick/](server/src/kick/) |
| `hls` | `url` | Generic HLS playlist |
| `whip` | `username` | WebRTC intake; returns `bearerToken` + `whipUrl` |
| `local-mp4` | `source: { fileName \| audioFileName \| url }` | Three source variants in one type |
| `image` | `fileName?` or `imageId?` | Image asset (registered or by file) |
| `text-input` | `text`, `textAlign?`, `textScrollEnabled?` | Scrolling overlays |
| `game` | `title?` | Snake game input (see Snake Game section) |
| `hands` | `sourceInputId` | MediaPipe Hands overlay driving the `cyberpunk-hands` shader |

Other input-level routes (all `POST` except where noted):

| Path | Purpose |
|---|---|
| `/room/:roomId/input/:inputId` | Update — see `UpdateInputSchema` ([routes.ts:1949](server/src/routing/routes.ts:1949)); covers title, volume, showTitle, text props (color, max-lines, font size, scroll speed/loop/nudge, align), shaders, border, snake settings, attached inputs, absolute position + transition, crop, activeTransition |
| `/room/:roomId/input/:inputId/connect` | Resume / reconnect input |
| `/room/:roomId/input/:inputId/disconnect` | Pause / close input |
| `/room/:roomId/input/:inputId/hide` | Hide with optional `activeTransition: { type, durationMs, direction }` |
| `/room/:roomId/input/:inputId/show` | Show with optional transition |
| `/room/:roomId/inputs/hide` | Batch hide (body `{ inputIds[], activeTransition? }`) — single mutex |
| `/room/:roomId/inputs/show` | Batch show — single mutex |
| `/room/:roomId/input/:inputId/whip/ack` | WHIP bearer-token handshake |
| `/room/:roomId/input/:inputId/resolve-missing-mp4` | Re-bind MP4 source after import |
| `/room/:roomId/input/:inputId/resolve-missing-image` | Re-bind image source |
| `/room/:roomId/input/:inputId/mp4-restart` | Seek MP4 — `{ playFromMs, loop }` |
| `/room/:roomId/input/:inputId/motion-detection` | Toggle motion — `{ enabled }` |
| `DELETE /room/:roomId/input/:inputId` | Remove input |
| `POST /room/:roomId/pending-whip-inputs` | Stage pending WHIPs the editor expects |

### Layout & layers

`POST /room/:roomId` (the same room-update endpoint above) accepts `layers`, `inputOrder`, swap settings (`swapDurationMs`, `swapOutgoingEnabled`, `swapFadeInDurationMs`, `swapFadeOutDurationMs`), viewport fields (top/left/width/height + transitionDurationMs/Easing), `outputShaders`, and `isPublic`. Each layer is `{ id, inputs: [{ inputId, x, y, width, height, transitionDurationMs?, transitionEasing?, cropTop/Left/Right/Bottom? }], behavior? }`. Behaviors are tagged unions — `equal-grid`, `approximate-aspect-grid`, `exact-aspect-grid`, `picture-in-picture` — see schema at [routes.ts:1359](server/src/routing/routes.ts:1359).

Layout *names* used by the editor and voice commands (7 total): `grid`, `primary-on-left`, `primary-on-top`, `picture-in-picture`, `wrapped`, `wrapped-static`, `picture-on-picture`. These are not server enums — they're editor-side preset layouts that compute the actual `layers[]` payload.

### Shaders

`GET /shaders` returns the currently active shader catalog (only `isActive: true`, both visible and hidden), each item carrying `iconSvg` read from [server/shaders/icons/](server/shaders/icons/).

The shader catalog lives in [server/src/shaders/shaders.tsx](server/src/shaders/shaders.tsx). **35 shaders total** — 26 user-visible, 9 hidden (internal or transitions). Each shader has typed params (number with min/max/default, or color hex):

| ID | Visible | Purpose |
|---|---|---|
| `ascii-filter` | ✅ | ASCII art filter (glyph_size, gamma_correction) |
| `grayscale` | ✅ | Desaturate to grayscale |
| `opacity` | ✅ | Per-input alpha |
| `brightness-contrast` | ✅ | Linear brightness + contrast |
| `circle-mask-outline` ("Wrapped Outline") | ✅ | Circular mask + animated outline + orbital trails (19 params) |
| `remove-color` | ✅ | Single-target chroma key with tolerance |
| `color-key` | ✅ | Ultra-Key-style chroma (matte, cleanup, spill, color correction — 15 params) |
| `ultra-key` | ✅ | HSV-based chroma with independent H/S/L softness |
| `orbiting` | ✅ | Orbiting copies + animated sun rays |
| `star-streaks` | ✅ | Warp-star streaks |
| `soft-shadow` | ✅ | Soft drop shadow with animation |
| `alpha-stroke` | ✅ | Outline along alpha edges |
| `sw-hologram` | ✅ | Star Wars hologram (scanlines, flicker, chromatic aberration, bloom) |
| `perspective` | ✅ | Perspective foreshortening + rotation |
| `organic-zoom` | ✅ | Cinematic zoom with breathing/drift/wobble |
| `blur` | ✅ | Directional Gaussian blur, alpha-preserving |
| `hsl-adjust` | ✅ | Hue / saturation / lightness + colorize |
| `vignette` | ✅ | Configurable edge darken |
| `chromatic-aberration` | ✅ | RGB-channel offset + animation |
| `sharpen` | ✅ | Unsharp mask + edge detect mix |
| `snake-event-highlight` | ✅ | 8 effect modes (pulse, flash, shake, color shift, ripple, vignette, chromatic burst, pixelate) |
| `comic-book` | ✅ | Multi-scale ink + posterize + halftone + speed lines |
| `neon-glow` | ✅ | Edge-bloom neon |
| `vhs-distortion` | ✅ | Jitter / tape warp / scanlines / dropouts / ghosting |
| `cyber-glitch` | ✅ | Slice displacement + RGB split + block artifacts |
| `neon-edge` | ✅ | Tron wireframe glow |
| `hex-grid` | ✅ | Hexagonal pixelation HUD |
| `page-flip-1` | hidden | 3D page-flip transition |
| `sine-wave` | hidden | Vertical sine distortion |
| `grid-overlay` | hidden | Procedural grid |
| `transition-slide` | hidden | Used by transition system |
| `transition-wipe` | hidden | Used by transition system |
| `transition-dissolve` | hidden | Used by transition system |
| `cyberpunk-hands` | hidden | Driven by `hands` input via MediaPipe |
| `crop` | hidden | Internal — auto-applied per-input when crop fields set on layers |

Shaders apply at two scopes:
- **Per input** — `shaders` field in `UpdateInputSchema`; each `{ shaderName, shaderId, enabled, params: [{ paramName, paramValue }] }`. Editor UI: [editor/components/control-panel/input-entry/shader-panel.tsx](editor/components/control-panel/input-entry/shader-panel.tsx).
- **Output (post-composite)** — `outputShaders` field on `UpdateRoomSchema`; same shape, rendered as a stack on the final frame in [server/src/app/App.tsx](server/src/app/App.tsx) via `wrapWithShaders()`.

### Recording

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/room/:roomId/record/start` | Start MP4 recording → `{ status: 'recording', fileName }` |
| `POST` | `/room/:roomId/record/stop` | Stop → `{ status: 'stopped', fileName, downloadUrl }` |
| `GET` | `/recordings` | List all `{ fileName, roomId, createdAt, size }` |
| `GET` | `/room/:roomId/recordings` | Filter list by room prefix |
| `GET` | `/recordings/:fileName` | Stream MP4 (range supported) |

Recordings auto-pruned to 10 files. Stored under `server/recordings/`.

### Motion detection & audio analysis

| Path | Purpose |
|---|---|
| `POST /room/:roomId/input/:inputId/motion-detection` | Toggle per-input detection — `{ enabled }` |
| `GET /room/:roomId/motion-scores/sse` | SSE stream of `Record<inputId, score>`; 15 s heartbeat |
| `POST /room/:roomId/audio-analysis` | Toggle per-room audio analysis — `{ enabled }` |
| `GET /room/:roomId/audio-levels/sse` | SSE stream of per-input frequency levels |

Motion pipeline (see [server/src/motion/](server/src/motion/)): React grid → RTP → ffmpeg → Python (`opencv-python-headless`, `numpy`) → JSON scores → SSE. Python venv lives at `server/motion/.venv/`, or override with `MOTION_PYTHON_PATH`. Editor consumer: [editor/hooks/use-motion-scores.ts](editor/hooks/use-motion-scores.ts), proxy SSE route [editor/app/api/room/[roomId]/motion-scores/sse/route.ts](editor/app/api/room/[roomId]/motion-scores/sse/route.ts).

### Timeline routes (plugin)

Mounted via `registerTimelineRoutes(routes)` at [server/src/timeline/timelineRoutes.ts](server/src/timeline/timelineRoutes.ts).

| Path | Body | Purpose |
|---|---|---|
| `POST /room/:roomId/timeline/play` | `{ playheadMs? }` | Start playback |
| `POST /room/:roomId/timeline/pause` | — | Pause |
| `POST /room/:roomId/timeline/seek` | `{ playheadMs }` | Jump |
| `POST /room/:roomId/timeline/apply` | `{ segments?, … }` | Push full timeline config to the server |
| `GET /room/:roomId/timeline/sse` | — | Stream `{ isPlaying, isPaused, playheadMs, totalDurationMs }` plus clip events |

Playback engine: [server/src/timeline/TimelinePlayer.ts](server/src/timeline/TimelinePlayer.ts) precomputes all events (connect, disconnect, transition-in, transition-out, keyframe) and emits them in order. Keyframes interpolate `blockSettings` linearly (`smooth`) or snap (`step`).

### Storage (generic CRUD factory)

`registerStorageRoutes(routes, opts)` mounts `POST /save`, `GET /list`, `GET /:fileName`, optional `POST /:fileName` (update), and `DELETE /:fileName` under a configurable prefix. **5 backends** registered ([routes.ts:1285](server/src/routing/routes.ts:1285)):

| Prefix | Resource | Payload key | Update supported? |
|---|---|---|---|
| `/configs` | Room config (full export) | `config` | no |
| `/shader-presets` | Per-input shader chain preset | `shaders` | yes |
| `/presentation-configs` | Presentation mode config | `presentationConfig` | yes |
| `/dashboard-layouts` | Dashboard grid layout | `layout` | no |
| `/hls-streams` | Saved HLS stream URLs | `stream` (`{ url }`) | yes |

Editor client factory: [editor/lib/storage-client.ts](editor/lib/storage-client.ts) — `createStorageClient<T>(req, prefix, payloadKey, listKey)`. Shared modals: [editor/components/storage-modals.tsx](editor/components/storage-modals.tsx).

### Snake game (plugin)

Mounted via `registerSnakeGameRoutes(routes)` at [server/src/snakeGame/snakeGameRoutes.ts](server/src/snakeGame/snakeGameRoutes.ts).

| Path | Purpose |
|---|---|
| `POST /room/:roomId/snake-game/state` | Push board state — `{ seq, board, cells, gameId? }`. Out-of-order seqs return 400. |
| `POST /game-state` | Same payload without `roomId` — uses sticky-room model (source key from `x-game-id` header or `x-forwarded-for + user-agent`). First `seq=1` creates the room; restarts reuse the room. |

Game state model + processing: [server/src/snakeGame/snakeGameState.ts](server/src/snakeGame/snakeGameState.ts). Public DTO mapping: [server/src/snakeGame/publicSnakeGameState.ts](server/src/snakeGame/publicSnakeGameState.ts). React rendering for video: [server/src/snakeGame/SnakeGameBoard.tsx](server/src/snakeGame/SnakeGameBoard.tsx). Terminal dashboard: [server/src/snakeGame/snakeGameDashboard.ts](server/src/snakeGame/snakeGameDashboard.ts).

### Media browsing, playback, uploads

| Path | Purpose |
|---|---|
| `GET /suggestions` | Aggregate (Twitch top streams) |
| `GET /suggestions/twitch`, `GET /suggestions/kick` | Top live channels |
| `GET /suggestions/mp4s`, `/pictures`, `/audios` | Flat list of files in `DATA_DIR/{mp4s,pictures,audios}` |
| `GET /suggestions/mp4s/browse`, `/pictures/browse`, `/audios/browse` | Folder paginate — `{ files, folders, fileInfos: [{ fileName, size, uploadedAtMs }] }` |
| `GET /suggestions/mp4-duration?fileName=...` | `{ durationMs }` |
| `GET /suggestions/mp4-thumbnail?fileName=...` | JPEG (cached 24 h in `thumbnails/mp4/`) |
| `GET /suggestions/audio-waveform?fileName=...` | PNG waveform (24 h cache) |
| `GET /suggestions/pictures/:fileName` | Serve picture |
| `GET /hls-streams/thumbnail/:fileName` | JPEG snapshot of an HLS stream |
| `GET /play/mp4/*`, `/play/audio/*` | Stream with `Range` (206) |
| `GET /download/mp4/*`, `/download/audio/*` | Download as attachment |
| `POST /upload/mp4`, `/upload/picture`, `/upload/audio`, `/upload/font` | Multipart upload (≤ 500 MB) |
| `DELETE /upload/mp4/*`, `/upload/picture/*`, … | Delete uploaded asset |
| `GET /upload/progress` | Active upload progress |

Upload routes: [server/src/core/routes/uploadRoutes.ts](server/src/core/routes/uploadRoutes.ts).

### Real-time channels

**WebSocket** — `WS /room/:roomId/ws` (Fastify `@fastify/websocket`). Server pushes:

| Event type | Payload |
|---|---|
| `room_updated` | `{ roomId, sourceId, layers, inputs, isTimelinePlaying }` on layout/structure change |
| `input_updated` | `{ roomId, inputId, input, sourceId }` on input property change |
| `input_deleted` | `{ roomId, inputId, sourceId }` |
| `timeline_playback_updated` | `{ roomId, isTimelinePlaying, isPaused, playheadMs, totalDurationMs }` |
| `room_deleted` | `{ roomId }` |

The `sourceId` header (`x-source-id`) on inbound requests is echoed back so clients can ignore their own broadcasts (used by editor + mobile app).

**Server-Sent Events** (all heartbeat every 15 s):

| Path | Stream |
|---|---|
| `/room/:roomId/state/sse` | Full room snapshot on every change |
| `/room/:roomId/motion-scores/sse` | Per-input motion scores |
| `/room/:roomId/audio-levels/sse` | Per-input audio frequency levels |
| `/room/:roomId/timeline/sse` | Timeline playback state + events |
| `/logs/sse` | Dashboard/system log with batch backlog |

### Resolutions

Presets accepted on `POST /room` (see schema at [routes.ts:884](server/src/routing/routes.ts:884)):

`720p`, `1080p`, `1440p` (default), `4k`, `720p-vertical`, `1080p-vertical`, `1440p-vertical`, `4k-vertical`. Or arbitrary `{ width, height }` (≥ 1).

Canonical map: [packages/types/src/](packages/types/src/) `RESOLUTION_PRESETS`. Editor re-export: [editor/lib/resolution.ts](editor/lib/resolution.ts).

## Editor capabilities

### Server actions

[editor/app/actions/actions.ts](editor/app/actions/actions.ts) is the single funnel for HTTP calls — every UI mutation goes through `sendSmelterRequest()`. Per-input add helpers:

| Editor function | Wraps server type |
|---|---|
| `addTwitchInput(roomId, channelId)` | `twitch-channel` |
| `addKickInput(roomId, channelId)` | `kick-channel` |
| `addMP4Input(roomId, mp4FileName)` | `local-mp4 { source: { fileName } }` |
| `addAudioInput(roomId, audioFileName)` | `local-mp4 { source: { audioFileName } }` |
| `addImageInput(roomId, imageFileNameOrId)` | `image` |
| `addTextInput(roomId, text, …)` | `text-input` |
| `addSnakeGameInput(roomId, title?)` | `game` |
| `addHandsInput(roomId, sourceInputId)` | `hands` |
| `addHlsInput(roomId, url)` | `hls` |
| `addCameraInput(roomId, …)` | `whip` |

Also worth knowing: `acknowledgeWhipInput()`, `restartService()` (calls `sudo systemctl restart smelter.service` — trusted environments only), `setPendingWhipInputs()`, plus the storage-modal CRUD pairs for configs, shader presets, presentation configs, dashboard layouts, and HLS streams.

### Control panel

[editor/components/control-panel/](editor/components/control-panel/) — single 87 KB `control-panel.tsx` orchestrates these subcomponents under `components/`, `hooks/`, `contexts/`, `input-entry/`, `sortable-list/`:

| Component | What it does |
|---|---|
| [StreamsSection.tsx](editor/components/control-panel/components/StreamsSection.tsx) | Input list with drag/drop ordering |
| [AddVideoModal.tsx](editor/components/control-panel/components/AddVideoModal.tsx) | "Add input" dialog with type-specific forms |
| [LayersSection.tsx](editor/components/control-panel/components/LayersSection.tsx) | Layer reordering (sortMode-gated — see Timeline section) |
| [AbsolutePositionController.tsx](editor/components/control-panel/components/AbsolutePositionController.tsx) | Visual drag/resize for absolute-positioned inputs |
| [ShaderPresetModals.tsx](editor/components/control-panel/components/ShaderPresetModals.tsx) | Save / load / update shader presets |
| [ConfigModals.tsx](editor/components/control-panel/components/ConfigModals.tsx) | Save / load room configs |
| [TimelinePanel.tsx](editor/components/control-panel/components/TimelinePanel.tsx) + [timeline/](editor/components/control-panel/components/timeline/) | Timeline editor (see deep dive) |
| [TimelineGroupHeader.tsx](editor/components/control-panel/components/TimelineGroupHeader.tsx) | Track-group collapse / rename / icon |
| [BlockClipPropertiesPanel.tsx](editor/components/control-panel/components/BlockClipPropertiesPanel.tsx) + [block-clip/](editor/components/control-panel/components/block-clip/) | Edit selected clip / keyframe settings |
| [FxAccordion.tsx](editor/components/control-panel/components/FxAccordion.tsx) | Output shader stack |
| [TransitionSettings.tsx](editor/components/control-panel/components/TransitionSettings.tsx) | Swap fade-in / fade-out durations |
| [ViewportSettings.tsx](editor/components/control-panel/components/ViewportSettings.tsx) | Output viewport crop with animated transitions |
| [MotionDetectionPanel.tsx](editor/components/control-panel/components/MotionDetectionPanel.tsx) | Per-input motion chart aggregator |
| [PendingWhipInputs.tsx](editor/components/control-panel/components/PendingWhipInputs.tsx), [PendingConnectionsPanel.tsx](editor/components/control-panel/components/PendingConnectionsPanel.tsx) | Incoming WHIP staging |
| [ResolveMissingAssetModal.tsx](editor/components/control-panel/components/ResolveMissingAssetModal.tsx) | Re-bind MP4 / image after import |
| [SwapSourceModal.tsx](editor/components/control-panel/components/SwapSourceModal.tsx) | Swap clip source while preserving position |
| [PresentationModeSettings.tsx](editor/components/control-panel/components/PresentationModeSettings.tsx) | Presentation-mode config |
| [IconPicker.tsx](editor/components/control-panel/components/IconPicker.tsx), [track-icons.ts](editor/components/control-panel/components/track-icons.ts) | Per-row track / group icons |
| [import-progress-dialog.tsx](editor/components/control-panel/components/import-progress-dialog.tsx) | Phase / current / total UI for full-project import |

Hooks live in [editor/components/control-panel/hooks/](editor/components/control-panel/hooks/):

| Hook | Purpose |
|---|---|
| `use-control-panel-state.ts` | Root state shape for the control panel |
| `use-control-panel-events.ts` | Window-event bus (e.g. `smelter:timeline:*`) |
| `use-control-panel-input-order-events.ts` | Drag-drop reordering |
| `use-room-websocket.ts` | WS connection to `/room/:roomId/ws` |
| `use-server-timeline-playback.ts` | Subscribes to timeline SSE and updates UI |
| `use-timeline-state.ts` | The timeline reducer (see deep dive) |
| `timeline-playhead-sync.ts` | Keeps editor playhead in sync with server |
| `use-recording-controls.ts` | Optimistic record toggle + auto-download |
| `use-resolve-missing-local-mp4-source.ts` | Re-bind flow |
| `use-whip-connections.ts` | WHIP intake monitoring |

### Timeline (deep dive)

State machine: [editor/components/control-panel/hooks/use-timeline-state.ts](editor/components/control-panel/hooks/use-timeline-state.ts) (V4 schema). Persistence + migration V1→V4: [editor/lib/timeline-storage.ts](editor/lib/timeline-storage.ts). Layer-order helpers: [editor/lib/timeline-layer-order.ts](editor/lib/timeline-layer-order.ts). Config typing: [editor/lib/timeline-config.ts](editor/lib/timeline-config.ts).

**Data model**:
- `StoredTrack { id, label, clips[], icon? }`
- `StoredTrackGroup { id, label, icon?, collapsed, trackIds[] }` (V4)
- `rootOrder: ({ kind: 'track', id } | { kind: 'group', id })[]` (V4) — flat list with explicit nesting
- `StoredClip { id, inputId, startMs, endMs, blockSettings?, keyframes? }`
- `StoredKeyframe { id, timeMs, blockSettings }`
- `BlockSettings` — large extensible payload (shaders, volume, text props, position, crop, mp4 restart/loop, snake board styling, attached inputs, transitions). Each clip + keyframe carries a full snapshot.

**Reducer actions** (cases in `use-timeline-state.ts`):

| Domain | Actions |
|---|---|
| Global | `SYNC_TRACKS`, `RESET`, `LOAD`, `SET_PLAYHEAD`, `SET_PLAYING`, `SET_ZOOM` (clamps 2-100 px/s), `SET_TOTAL_DURATION`, `SET_KEYFRAME_INTERPOLATION_MODE` (`step` / `smooth`), `SET_SNAP_TO_BLOCKS`, `SET_SNAP_TO_KEYFRAMES` |
| Clips | `MOVE_CLIP`, `RESIZE_CLIP`, `SPLIT_CLIP`, `DELETE_CLIP`, `DUPLICATE_CLIP`, `MOVE_CLIP_TO_TRACK`, `MOVE_CLIPS` (batch), `DELETE_CLIPS` (batch), `SWAP_CLIP_INPUT`, `UPDATE_CLIP_SETTINGS` |
| Keyframes | `ADD_KEYFRAME`, `UPDATE_KEYFRAME`, `DELETE_KEYFRAME`, `MOVE_KEYFRAME` |
| Tracks | `ADD_TRACK`, `RENAME_TRACK`, `DELETE_TRACK`, `REORDER_TRACK` (legacy), `SET_TRACK_ICON`, `REPLACE_INPUT_ID`, `PURGE_INPUT_ID`, `CLEANUP_SPURIOUS_WHIP_TRACK` |
| Groups (V4) | `ADD_GROUP`, `DELETE_GROUP`, `RENAME_GROUP`, `MOVE_GROUP`, `SET_GROUP_COLLAPSED`, `SET_GROUP_ICON`, `MOVE_TRACK_TO` (reparent across `root` / `group`) |

**Storage keys** (localStorage): `smelter-timeline-${roomId}`, plus event-feedback prefs `smelter:timeline-events:enabled`, `smelter:timeline-events:position`, `smelter:timeline-events:size`, `smelter:timeline-events:duration`. Crash recovery uses `smelter:crash-recovery`. GC: `pruneOldTimelineEntries()` evicts up to 3 oldest rooms on quota.

**Recent commits**: track grouping + per-row icons ([#134](https://github.com/anthropics/streaming/pull/134)), layer drag-and-drop rewrite + sortMode gating ([#136](https://github.com/anthropics/streaming/pull/136)). When `sortMode === 'timeline'`, layer reordering UI is disabled to prevent DnD conflicts; when `sortMode === 'layers'`, layer DnD is the active mechanism.

**Server-driven playback**: `TimelinePlayer` precomputes all clip-boundary events and emits them via the SSE stream. The editor subscribes through `use-server-timeline-playback.ts`. Smooth keyframe interpolation is server-side only; the editor visualizes keyframes as discrete points.

**Known gaps** (from AGENTS.md): timeline restore gap on stop (absolute-position fields not reverted), SYNC_TRACKS stale-`knownInputIds` race after fast remove-add churn, motion slot reassignment after input churn can produce short-lived false motion spikes.

### Dashboard

[editor/components/dashboard/](editor/components/dashboard/) — react-grid-layout shell.

**Static panels** ([panel-registry.ts](editor/components/dashboard/panel-registry.ts) — `STATIC_PANEL_DEFINITIONS`):

`video-preview`, `streams`, `fx`, `timeline`, `block-properties`, `pending-connections`, `connected-devices`, `system-log`, `motion-detection`, `layout-preview`.

Plus dynamic `motion:${inputId}` panels created per input when motion detection is on.

**Default visible** (`DEFAULT_VISIBLE_PANEL_IDS`): `video-preview`, `streams`, `timeline`, `block-properties`, `system-log`.

**Breakpoints** (`DASHBOARD_BREAKPOINT_WIDTHS` / `DASHBOARD_COLS`):

| Name | Width ≥ | Columns |
|---|---|---|
| `lg` | 1200 | 24 |
| `md` | 996 | 20 |
| `sm` | 768 | 12 |
| `xs` | 480 | 8 |
| `xxs` | 0 | 4 |

**Layout presets** (`LAYOUT_PRESETS`): `default`, `wide-video`, `compact`, `equal-split`, `vertical-video`. Each preset is a full `LayoutItem[]` keyed by panel id with `{ x, y, w, h, minW, minH }`. The first preset is exported as `DEFAULT_LAYOUT`.

**Persistence** (localStorage): `smelter-dashboard-layout` (layouts per breakpoint), `smelter-dashboard-visible-panels` (panel ids).

### Voice commands

[editor/lib/voice/](editor/lib/voice/) — speech-to-text → normalize → parse → dispatch → execute, with macros.

**Pipeline files**:
- [commandTypes.ts](editor/lib/voice/commandTypes.ts) — discriminated-union `VoiceCommand` (30+ intents)
- [parseCommand.ts](editor/lib/voice/parseCommand.ts) — regex parser with aliases
- [normalize.ts](editor/lib/voice/normalize.ts) — preprocessing (lowercase, number words, punctuation)
- [levenshtein.ts](editor/lib/voice/levenshtein.ts) — fuzzy MP4 / image file matching (≈0.4 minimum similarity)
- [dispatchCommand.ts](editor/lib/voice/dispatchCommand.ts) — routes parsed intent to editor actions
- [macroTypes.ts](editor/lib/voice/macroTypes.ts), [macroExecutor.ts](editor/lib/voice/macroExecutor.ts), [macros.json](editor/lib/voice/macros.json) — sequence-of-steps definition + runner
- [macroSettings.ts](editor/lib/voice/macroSettings.ts) — feedback / panel preferences
- [useVoiceCommands.ts](editor/lib/voice/useVoiceCommands.ts) — React hook integrating Web Speech API + parsing + feedback
- [feedbackEvents.ts](editor/lib/voice/feedbackEvents.ts) — UI feedback bus
- Test surface: [editor/lib/voice/__tests__/parseCommand.test.ts](editor/lib/voice/__tests__/parseCommand.test.ts) is the canonical "what works" reference.

**Intents** (from `commandTypes.ts`):
- Input: `ADD_INPUT`, `MOVE_INPUT`, `REMOVE_INPUT`, `SELECT_INPUT`, `DESELECT_INPUT`, `HIDE_ALL_INPUTS`, `REMOVE_ALL_INPUTS`
- Shader: `ADD_SHADER`, `REMOVE_SHADER`
- Layout: `NEXT_LAYOUT`, `PREVIOUS_LAYOUT`, `SET_LAYOUT`
- Text: `SET_TEXT`, `SET_TEXT_COLOR`, `SET_TEXT_MAX_LINES`, `SET_TEXT_FONT_SIZE`, `SET_TEXT_SCROLL_SPEED`, `SET_TEXT_ALIGN`, `SCROLL_TEXT`
- Recording: `START_RECORDING`, `STOP_RECORDING`
- Transitions: `SET_SWAP_DURATION`, `SET_SWAP_FADE_IN_DURATION`, `SET_SWAP_FADE_OUT_DURATION`, `SET_SWAP_OUTGOING_ENABLED`
- Timeline: `SELECT_TRACK`, `REMOVE_TRACK`, `NEXT_BLOCK`, `PREV_BLOCK`, `START_TYPING`, `STOP_TYPING`
- System: `START_ROOM` (with `vertical?`), `EXPORT_CONFIGURATION`, `CLARIFY` (asks user to disambiguate)

**Shader aliases** (voice-only — these don't map to the full 35-shader catalog): `ASCII`, `GRAYSCALE`, `OPACITY`, `BRIGHTNESS_CONTRAST`, `WRAPPED` (→ `circle-mask-outline`), `REMOVE_COLOR`, `ORBITING`, `STAR_STREAKS`, `SHADOW` (→ `soft-shadow`), `HOLOGRAM` (→ `sw-hologram`), `PERSPECTIVE`, `ALPHA_STROKE`.

**Voice InputType** (subset of server types, mapped at dispatch): `STREAM`, `MP4`, `IMAGE`, `TEXT`, `CAMERA`, `SCREENSHARE`.

**Layout aliases** (see `parseCommand.ts`): `primary left` / `left primary` / `primary on left` → `primary-on-left`; `pip` → `picture-in-picture`; `pop` → `picture-on-picture`; etc.

### Motion detection UI

- [editor/hooks/use-motion-scores.ts](editor/hooks/use-motion-scores.ts) — SSE subscription
- [editor/hooks/use-motion-history.ts](editor/hooks/use-motion-history.ts) — rolling history buffer for charts
- [editor/components/control-panel/input-entry/motion-chart.tsx](editor/components/control-panel/input-entry/motion-chart.tsx) — SVG area chart rendered inline in the input row
- [editor/app/api/room/[roomId]/motion-scores/sse/route.ts](editor/app/api/room/[roomId]/motion-scores/sse/route.ts) — Next.js proxy of the server's SSE

### Recording UI

[editor/components/control-panel/hooks/use-recording-controls.ts](editor/components/control-panel/hooks/use-recording-controls.ts) — optimistic toggle + delayed auto-download. Triggers `smelter:recording-download-started` window event when the download begins.

### Settings / preferences

All hook-per-setting, all localStorage-backed:

- Voice feedback (position / size / duration / panel size / opacity / autoplay): [editor/lib/voice/macroSettings.ts](editor/lib/voice/macroSettings.ts)
- Timeline event notifications (enabled / position / size / duration): [editor/lib/timeline-event-settings.ts](editor/lib/timeline-event-settings.ts), [editor/lib/timeline-event-notifications.ts](editor/lib/timeline-event-notifications.ts)
- Video overlay (line width / glowing): [editor/lib/video-overlay-settings.ts](editor/lib/video-overlay-settings.ts)
- Default orientation (vertical flag): via `useDefaultOrientationSetting()` in voice macro settings
- Global modal: [editor/components/settings-modal.tsx](editor/components/settings-modal.tsx)

### Export / import / zip

- JSON serialization of a room: [editor/lib/room-config.ts](editor/lib/room-config.ts) (`exportRoomConfig` / `importRoomConfig` — handles inputs, layout, timeline, output shaders, viewport, snake settings)
- Full project ZIP (manifest + room-config.json + mp4s/audios/pictures up to 3-level depth): [editor/lib/full-project-zip.ts](editor/lib/full-project-zip.ts)
- Streaming import with progress phases: [editor/lib/import-config-stream.ts](editor/lib/import-config-stream.ts)
- UI: `ImportProgressDialog` in [control-panel/components/import-progress-dialog.tsx](editor/components/control-panel/components/import-progress-dialog.tsx)

### WHEP playback / video preview / WHIP intake

- [editor/components/video-preview.tsx](editor/components/video-preview.tsx), [editor/components/output-stream.tsx](editor/components/output-stream.tsx), [editor/components/output-stream-grid.tsx](editor/components/output-stream-grid.tsx) — WHEP player with draft mode (hide all inputs at once), volume, fullscreen
- Pending WHIPs flow: editor `setPendingWhipInputs()` → `POST /room/:roomId/pending-whip-inputs` → server stages → WHIP source connects → `POST /room/:roomId/input/:inputId/whip/ack` confirms the bearer token

### Snake game (editor side)

| File | Purpose |
|---|---|
| [editor/lib/snake-game-types.ts](editor/lib/snake-game-types.ts) | Re-exports event types from `@smelter-editor/types` |
| [editor/lib/snake-events.ts](editor/lib/snake-events.ts) | The 8 event labels: `speed_up`, `cut_opponent`, `got_cut`, `cut_self`, `eat_block`, `bounce_block`, `no_moves`, `game_over` |
| [editor/lib/snake-shader-presets.ts](editor/lib/snake-shader-presets.ts) | Per-player visual shader presets |
| [editor/lib/snake-event-effect-presets.ts](editor/lib/snake-event-effect-presets.ts) | Per-event effect presets (application mode, duration, param overrides) |
| [editor/components/control-panel/components/AddVideoModal.tsx](editor/components/control-panel/components/AddVideoModal.tsx) | "Add input" dialog — the Snake game is added through the same modal as other input types |
| [editor/components/control-panel/input-entry/snake-event-shader-panel.tsx](editor/components/control-panel/input-entry/snake-event-shader-panel.tsx) | Per-event shader configuration UI |
| [editor/app/api/game-state/](editor/app/api/game-state/) | Next.js proxy for game state pushes |

### Crash recovery

[editor/lib/crash-recovery.ts](editor/lib/crash-recovery.ts) — single-room snapshot in localStorage key `smelter:crash-recovery`, TTL 2 h. Persists full `RoomConfig` (inputs, timeline, output shaders, viewport, layers). Loaded on app init; cleared once the room is restored. Note: only one room's snapshot is kept.

### Utilities worth knowing

- [editor/lib/color-utils.ts](editor/lib/color-utils.ts) — hex / HSL / int conversions (`hexToPackedInt`, `hslToHex`)
- [editor/lib/source-fit.ts](editor/lib/source-fit.ts) — aspect-fit math for video sources
- [editor/lib/format-utils.ts](editor/lib/format-utils.ts) — duration formatting for UI
- [editor/lib/keyboard.ts](editor/lib/keyboard.ts) — `shouldIgnoreGlobalShortcut(target)` guard for `<input>` / `<textarea>` / `contentEditable`
- [editor/lib/server-url.ts](editor/lib/server-url.ts), [editor/lib/server-url.server.ts](editor/lib/server-url.server.ts) — server URL resolution split by runtime
- [editor/lib/api-client.ts](editor/lib/api-client.ts) — typed REST client; mirrors server-action signatures
- [editor/lib/fx/](editor/lib/fx/) — FX/output-shader helpers
- [editor/lib/webrtc/](editor/lib/webrtc/) — WebRTC client utilities for WHEP playback

## Environment variables (feature gates)

Full list in [README.md](README.md) and [AGENTS.md](AGENTS.md). Highlights that gate behavior:

| Var | Effect |
|---|---|
| `SMELTER_DEMO_API_PORT` | Server port (default 3001) |
| `SMELTER_EDITOR_SERVER_URL` | Editor → server URL |
| `ENVIRONMENT=production` | Switches to Vulkan H.264 encoder + production WHEP/WHIP URLs |
| `SMELTER_H264_ENCODER` | `vulkan` (GPU) or `ffmpeg` (CPU `zerolatency`) |
| `SMELTER_H264_ENCODER_PRESET`, `SMELTER_H264_ENCODER_BITRATE` | Encoder tuning |
| `LAYOUT=boxed` | Enables the blessed TUI dashboard (rooms / inputs / motion / logs) |
| `MOTION_PYTHON_PATH` | Override Python binary for motion detector (default: auto venv) |
| `SMELTER_SNAKE_VISUAL_SPEED_MULTIPLIER` | Snake interpolation speed in Smelter renderer (default `1.25`) |
| `ALLOW_SMELTER_RESTART` | Gates `POST /restart-smelter` |
| `SMELTER_WS_DEBUG=true` | Verbose WebSocket upgrade logs |
| `WHIP_STALE_TTL_MS` | WHIP liveness window (default 15 s) |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Twitch OAuth |
| `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET` | Kick OAuth |

## Known issues (condensed from AGENTS.md)

- **Room init race** — `POST /room` returns before initial inputs finish connecting; clients should poll or rely on `room_updated` / `state/sse`.
- **Storage payload trust** — `/configs`, `/presentation-configs`, `/dashboard-layouts` use `Type.Any()` body schemas; corrupt hand-edited JSON can fail late.
- **Motion restart fragility** — detector retries after crashes, but slot-baseline reset is best-effort; expect transient false motion spikes after fast remove-add churn.
- **Timeline restore gap** — stopping playback does not restore the absolute-position fields the timeline applied.
- **`restartService`** trust boundary — editor action runs `sudo systemctl restart smelter.service`; do not expose to untrusted environments.
- **Dead code** — `editor/components/control-panel/components/MotionPanel.tsx` is unreferenced; `InputMotionPanel` is the live one.
- **WHIP slot churn** — motion slot reassignment + per-slot baselines diverge after rapid input churn.

## Cross-references

- [README.md](README.md) — architecture diagram, quick-start, env table
- [AGENTS.md](AGENTS.md) — code patterns, where-to-edit, server architecture
- [RULES.md](RULES.md) — workflow + accumulated code rules / past-mistake guardrails
- [SMELTEST.md](SMELTEST.md) — positioning vs. competing tools
- [.agents/skills/smelter-ts-docs/SKILL.md](.agents/skills/smelter-ts-docs/SKILL.md) — upstream `@swmansion/smelter` SDK skill (use for primitives like `<View>`, `<Tiles>`, `<InputStream>`, `registerInput`/`registerOutput`)
- [packages/types/src/](packages/types/src/) — canonical types: `Resolution`, `RESOLUTION_PRESETS`, `Layout`, `Layouts`, `ShaderConfig`, `ShaderParamConfig`, `ShaderPreset`, `TransitionType`, `TransitionConfig`, `ActiveTransition`, `InputOrientation`, `SnakeEventType`, `SnakeEventShaderConfig`, timeline types (`TimelineBlockSettings`, `TimelineClip`, `TimelineTrack`, `TimelineConfig`)
