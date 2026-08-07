#!/usr/bin/env bash
# Starts the Caddy single-origin proxy (:8080) + a Cloudflare Tunnel on
# https://workshop.smelter.dev — the public workshop domain. No ngrok involved.
# For everyday local testing on the ngrok domain use ./dev/tunnel.sh instead.
#
# One-time setup:
#   brew install cloudflared
#   cloudflared tunnel login                      # authorize the smelter.dev zone
#   cloudflared tunnel create workshop
#   cloudflared tunnel route dns --overwrite-dns workshop workshop.smelter.dev
#
# NOTE: routing DNS points workshop.smelter.dev at this tunnel (away from the
# Vercel deployment) — the domain only works while this script is running.
#
# Run the app separately (server + editor). See dev/README-tunnel.md.
# Usage: ./dev/tunnel-workshop.sh
set -euo pipefail

TUNNEL_NAME="workshop"
DOMAIN="workshop.smelter.dev"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v caddy >/dev/null || { echo "caddy not found (brew install caddy)"; exit 1; }
command -v cloudflared >/dev/null || { echo "cloudflared not found (brew install cloudflared)"; exit 1; }

cleanup() { kill "${CADDY_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT

echo "→ Caddy proxy on :8080 (merges :3000 editor, :3001 api, :9000 media)"
caddy run --config "$HERE/Caddyfile" --adapter caddyfile &
CADDY_PID=$!

sleep 1
echo "→ Cloudflare Tunnel https://$DOMAIN → :8080"
echo "→ Phone: https://$DOMAIN/mobile/<roomId>/shoot"
exec cloudflared tunnel run --url http://localhost:8080 "$TUNNEL_NAME"
