#!/usr/bin/env bash
# Workshop variant with the game engine running LOCALLY on this laptop, exposed
# through the puffer.fishjam.io nginx via a reverse SSH tunnel — no ngrok, no
# Cloudflare. The phone page stays on https://workshop.smelter.dev (Vercel) and
# is pointed at the tunnel with the ?server= query param (the Duck Hunter QR
# adds it automatically when the editor uses a public API URL).
#
# One-time setup on the box: add dev/nginx-workshop-location.conf to the
# puffer.fishjam.io server block and reload nginx.
#
# Run the app separately (server + editor). See dev/README-tunnel.md.
# Usage: ./dev/tunnel-ssh.sh [user@host]
set -euo pipefail

SSH_TARGET="${1:-${SMELTER_TUNNEL_SSH:-puffer.fishjam.io}}"
SSH_KEY="${SMELTER_TUNNEL_SSH_KEY:-$HOME/.ssh/smelt}"
REMOTE_PORT=18080 # must match proxy_pass in dev/nginx-workshop-location.conf
PUBLIC_API="https://puffer.fishjam.io/smelter-editor-workshop"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v caddy >/dev/null || { echo "caddy not found (brew install caddy)"; exit 1; }

cleanup() { kill "${CADDY_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT

echo "→ Caddy proxy on :8080 (merges :3000 editor, :3001 api, :9000 media)"
caddy run --config "$HERE/Caddyfile" --adapter caddyfile &
CADDY_PID=$!

sleep 1
echo "→ Reverse SSH: $SSH_TARGET:$REMOTE_PORT → localhost:8080"
echo "→ Phone: https://workshop.smelter.dev/mobile/<roomId>/shoot?server=$PUBLIC_API"
echo "  (WebRTC media is UDP straight to this laptop — phone must be on the same network)"
exec ssh -i "$SSH_KEY" -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -R "127.0.0.1:$REMOTE_PORT:localhost:8080" \
  "$SSH_TARGET"
