# Testing on a phone over HTTPS (so the gyroscope works)

The browser gyroscope (`deviceorientation`) only works in a **secure context
(HTTPS)**. The app, however, consists of **three services** on three ports:

| Service           | Port  | Paths                            |
| ----------------- | ----- | -------------------------------- |
| Editor (Next.js)  | 3000  | `/`, `/mobile/*`, `/_next/*`     |
| API + WebSocket   | 3001  | `/room/*`, `/ai-models`, …       |
| WebRTC media      | 9000  | `/whep/*`, `/whip/*`             |

A single tunnel exposes a single port, so the rest stays on HTTP → **mixed content**
(those were the `Mixed Block` errors in the console). The solution: glue everything
together under **one origin** with a proxy (Caddy) and run **one tunnel**.

## Steps

1. **Install Caddy** (`brew install caddy`) and a tunnel (you already have `ngrok`).

2. **Reserve a static ngrok domain** (the free plan gives you one), e.g. `abc.ngrok-free.dev`.

3. **Do NOT set** `SMELTER_WHEP_BASE_URL/SMELTER_WHIP_BASE_URL` — the desktop should
   keep using local media. The phone page rewrites WS/WHEP to its own origin
   (the tunnel) automatically when opened from outside localhost.

4. **Run (4 terminals):**
   ```
   ./dev/tunnel.sh                        # Caddy :8080 + ngrok on your domain
   pnpm --filter smelter-app start        # server :3001 (+ media :9000)
   pnpm --filter client dev               # editor :3000
   ```

## Workshop: nice domain `workshop.smelter.dev` (no ngrok)

The phone page stays on Vercel (`https://workshop.smelter.dev`), and the backend
is pointed at via the `?server=` parameter in the link/QR — the Duck Hunter panel
appends it automatically when the editor uses a public API (non-localhost). Two
backend variants:

- **Dev instance on the GPU box (zero tunnels):** the engine runs on
  gpu1-sandbox behind nginx. In the editor pick the "Instance B Dev" preset
  (`https://puffer.fishjam.io/smelter-editor-dev-api`) and that's it — the QR
  from the panel contains the right `?server=`.
- **Engine locally on the laptop:** `./dev/tunnel-ssh.sh` (Caddy :8080 +
  reverse SSH to the box, `smelter-editor-workshop` path in nginx — snippet in
  `dev/nginx-workshop-location.conf`, pasted in once). Note: WebRTC media
  (UDP) flows straight from the laptop, so the phone must be on the same network.

There is also `./dev/tunnel-workshop.sh` (a Cloudflare Tunnel taking over the whole
domain via DNS) — it requires authorization in the Cloudflare `smelter.dev` zone (DevOps).

5. **On the phone open** (without `?server=` — the page targets the tunnel origin itself):
   ```
   https://abc.ngrok-free.dev/mobile/<roomId>/shoot
   ```

6. In the game: set the input with the sprites to **full screen** (broadcast/solo) + Pac-Man ghosts,
   then on the phone switch to **Gyro**. Now `deviceorientation` works,
   because the page is served over HTTPS and everything comes from a single origin.

## Notes
- Open the desktop editor the old way via `http://localhost:3000` — on the tunnel
  origin `/room/*` is taken over by the API (on purpose), so the desktop
  `/room/<id>` page won't work through the tunnel (the phone doesn't use it).
- Alternative without Caddy: **Tailscale Serve** (built-in HTTPS + path routing),
  but it requires the Tailscale app on the phone.
- If the gyroscope still won't start on iOS: after opening the HTTPS page, switch
  to "Gyro" (the button re-requests motion permission — a user gesture is required).
