# Smelter Editor

Real-time video compositing studio built on [Smelter](https://github.com/swmansion/smelter). Combine live streams (Twitch, Kick), cameras (WebRTC/WHIP), local media, images, text overlays, and even a multiplayer Snake game — all mixed in configurable layouts with GPU-accelerated WGSL shaders and streamed out as WebRTC/WHEP.

## Architecture

```
+---------------------+       REST API        +----------------------------+
|       Editor        | <-------------------> |          Server            |
|  Next.js 15 / React |                       |  Fastify + Smelter Engine  |
|  Tailwind + shadcn  |    WHEP (video out)   |  React 18 -> video frames  |
|                     | <-------------------- |                            |
+---------------------+                       +----------------------------+
                                                    ^            ^
                                                    |            |
                                                WHIP/cam    HLS streams
                                                (WebRTC)   (Twitch/Kick)
```

- **`editor/`** — Web UI (Next.js 15, App Router, React 19, Tailwind 4, shadcn/ui) for managing rooms, inputs, layouts, and shaders.
- **`server/`** — Fastify API + Smelter rendering engine. Renders React 18 components (`<View>`, `<InputStream>`, `<Shader>`) directly to video frames — not the DOM.

## Features

- **7 input types** — Twitch channel, Kick channel, WHIP (camera/screenshare), local MP4, image, text overlay, Snake game
- **9 layout modes** — grid, primary-on-left, primary-on-top, picture-in-picture, wrapped, wrapped-static, transition, picture-on-picture, softu-tv
- **16 GPU shaders** — grayscale, ASCII filter, hologram, perspective warp, sine wave, soft shadow, orbiting, star streaks, and more (WGSL)
- **Room-based** — multiple independent compositing rooms, each with its own inputs, layout, and output stream
- **Recording** — per-room MP4 recording with automatic cleanup
- **Voice commands** — speech-to-text command system with macros
- **Room config export/import** — save and restore full room configurations as JSON
- **Guided tours** — driver.js onboarding for new users
- **Snake game input** — multiplayer Snake rendered as a video input with event-driven shader effects

## Prerequisites

- **Node.js** >= 20
- **pnpm**
- **GPU** (recommended) — NVIDIA or AMD for hardware-accelerated rendering. Falls back to CPU if no GPU is available.
- **streamlink** — for ingesting Twitch/Kick HLS streams (`pipx install streamlink`)
- **ffmpeg**

## Quick Start

### Local development

1. **Install dependencies**

```bash
# Editor
cd editor && pnpm install

# Server
cd server && pnpm install
```

2. **Configure environment**

```bash
# editor/.env.local
SMELTER_EDITOR_SERVER_URL=http://localhost:3001

# server/.env.local
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
KICK_CLIENT_ID=...
KICK_CLIENT_SECRET=...
```

3. **Start the server**

```bash
cd server
pnpm start          # Starts Fastify + Smelter on port 3001
```

4. **Start the editor**

```bash
cd editor
pnpm dev             # Next.js dev server with Turbopack
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Docker (production)

Requires an NVIDIA GPU with the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) installed.

1. Create a `secret.env` file with your API credentials:

```env
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
KICK_CLIENT_ID=...
KICK_CLIENT_SECRET=...
```

2. Build and run:

```bash
docker compose up --build
```

For AMD GPUs, uncomment the `devices` section and comment out `gpus`/`runtime` in `compose.yaml`.

**Exposed ports:**
| Port | Protocol | Description |
|------|----------|-------------|
| 9071 | HTTP | REST API |
| 9072 | HTTP | WHEP/WHIP (WebRTC) |

## Development Commands

### Editor (`cd editor/`)

| Command | Description |
|---------|-------------|
| `pnpm dev` | Dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm lint --fix` | ESLint + Prettier |
| `pnpm test` | Run vitest (watch mode) |
| `pnpm test:run` | Run vitest once (CI) |

### Server (`cd server/`)

| Command | Description |
|---------|-------------|
| `pnpm start` | Run with ts-node |
| `pnpm build` | Compile TypeScript |
| `pnpm watch` | TypeScript watch mode |

## Environment Variables

| Variable | Where | Description |
|----------|-------|-------------|
| `SMELTER_EDITOR_SERVER_URL` | editor | Server URL (e.g. `http://localhost:3001`) |
| `SMELTER_DEMO_API_PORT` | server | API port (default: `3001`) |
| `TWITCH_CLIENT_ID` | server | Twitch API client ID |
| `TWITCH_CLIENT_SECRET` | server | Twitch API client secret |
| `KICK_CLIENT_ID` | server | Kick API client ID |
| `KICK_CLIENT_SECRET` | server | Kick API client secret |
| `ENVIRONMENT` | server | `production` enables Vulkan encoder and production WHEP/WHIP URLs |
| `LAYOUT` | server | `boxed` enables the blessed TUI dashboard |
| `SMELTER_SNAKE_VISUAL_SPEED_MULTIPLIER` | server | Snake interpolation speed (default: `1.25`) |

## Project Structure

```
├── editor/                    # Next.js web UI
│   ├── app/
│   │   ├── actions/           # Server actions (API calls)
│   │   ├── room/[roomId]/     # Room page
│   │   └── api/game-state/    # Game state proxy
│   ├── components/
│   │   ├── control-panel/     # Input, layout, shader controls
│   │   ├── room-page/         # Room view + WHEP player
│   │   ├── tour/              # Guided onboarding tours
│   │   └── ui/                # shadcn/ui components
│   └── lib/
│       ├── voice/             # Speech-to-text commands
│       ├── room-config.ts     # Config export/import
│       └── resolution.ts      # Resolution presets
├── server/                    # Fastify + Smelter engine
│   ├── src/
│   │   ├── app/
│   │   │   ├── layouts/       # Layout React components
│   │   │   └── store.ts       # Zustand store (per room)
│   │   ├── game/              # Snake game module
│   │   ├── inputs/            # Input rendering components
│   │   ├── server/            # Fastify routes, room/server state
│   │   ├── shaders/           # Shader definitions
│   │   ├── twitch/            # Twitch integration
│   │   ├── kick/              # Kick integration
│   │   └── whip/              # WHIP input monitor
│   ├── shaders/               # WGSL shader source files
│   ├── mp4s/                  # Static MP4 assets
│   ├── pictures/              # Static image assets
│   └── fonts/                 # Font files
├── compose.yaml               # Docker Compose config
├── Dockerfile                 # Production container
└── entrypoint.sh
```

## License

MIT
