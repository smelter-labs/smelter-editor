#!/usr/bin/env bash
# Starts the Caddy single-origin proxy (:8080) + the ngrok tunnel on your static
# domain, so a phone can reach the app over HTTPS (needed for the gyroscope).
#
# Run the app separately (server + editor). See dev/README-tunnel.md.
# Usage: ./dev/tunnel.sh
set -euo pipefail

DOMAIN="nonbuoyant-hailee-rationally.ngrok-free.dev"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v caddy >/dev/null || { echo "caddy not found (brew install caddy)"; exit 1; }
command -v ngrok >/dev/null || { echo "ngrok not found"; exit 1; }

cleanup() { kill "${CADDY_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT

echo "→ Caddy proxy on :8080 (merges :3000 editor, :3001 api, :9000 media)"
caddy run --config "$HERE/Caddyfile" --adapter caddyfile &
CADDY_PID=$!

sleep 1
echo "→ ngrok https://$DOMAIN → :8080"
echo "→ Phone: https://$DOMAIN/mobile/<roomId>/shoot"
exec ngrok http --domain="$DOMAIN" 8080
